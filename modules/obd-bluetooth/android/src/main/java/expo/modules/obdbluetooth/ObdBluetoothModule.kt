package expo.modules.obdbluetooth

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothSocket
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.IOException
import java.util.UUID
import kotlin.concurrent.thread

private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
private val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805F9B34FB")

private fun uuid16(short: String): UUID = UUID.fromString("0000$short-0000-1000-8000-00805F9B34FB")

// Serial services used by BLE ELM327 dongles, tried first; any other
// non-standard service with a notify + write pair is used as a fallback.
private val KNOWN_SERVICES = listOf(
  uuid16("FFF0"), // Vgate iCar, OBDLink CX and most clones
  uuid16("FFE0"), // HM-10 style modules
  uuid16("18F0"), // Veepeak, some Vgate
  UUID.fromString("E7810A71-73AE-499D-8C15-FAA9AEF0C3F2"), // vLinker
)
private val STANDARD_SERVICES = setOf(
  uuid16("1800"), uuid16("1801"), uuid16("180A"), uuid16("180F"),
)
// Commands to the ELM327 are a few characters; the default ATT MTU carries 20 bytes.
private const val BLE_MAX_WRITE = 20

class BluetoothError(message: String) : CodedException(message)

/**
 * Serial link to a Bluetooth ELM327: Classic (SPP / RFCOMM) or BLE (GATT
 * notify + write characteristics). One link at a time; bytes arrive as
 * "onData" events (latin1 text), and "onClose" fires when an open link drops.
 * Android only. iOS has no SPP, and BLE there is not implemented yet.
 */
@SuppressLint("MissingPermission") // JS requests BLUETOOTH_CONNECT / BLUETOOTH_SCAN first
class ObdBluetoothModule : Module() {
  private interface Link {
    fun write(bytes: ByteArray, promise: Promise)
    fun close()
  }

  private var link: Link? = null
  private var pending: Link? = null // connecting; becomes `link` once open
  private var scan: ScanCallback? = null

  private val context: Context
    get() = appContext.reactContext ?: throw BluetoothError("React context lost")

  private fun adapter(): BluetoothAdapter =
    context.getSystemService(BluetoothManager::class.java)?.adapter
      ?: throw BluetoothError("This phone has no Bluetooth")

  private fun enabledAdapter(): BluetoothAdapter =
    adapter().takeIf { it.isEnabled } ?: throw BluetoothError("Bluetooth is off")

  override fun definition() = ModuleDefinition {
    Name("ObdBluetooth")
    Events("onData", "onClose", "onDevice")

    Function("isEnabled") {
      context.getSystemService(BluetoothManager::class.java)?.adapter?.isEnabled == true
    }

    /** Paired devices; a Classic dongle has to be paired in Android settings first. */
    Function("bondedDevices") {
      enabledAdapter().bondedDevices.map {
        mapOf(
          "id" to it.address,
          "name" to (it.name ?: it.address),
          "kind" to if (it.type == BluetoothDevice.DEVICE_TYPE_LE) "ble" else "classic",
        )
      }
    }

    Function("startScan") {
      val scanner = enabledAdapter().bluetoothLeScanner ?: throw BluetoothError("Bluetooth is off")
      stopScan()
      val cb = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
          val name = result.scanRecord?.deviceName ?: result.device.name ?: return
          sendEvent(
            "onDevice",
            mapOf("id" to result.device.address, "name" to name, "kind" to "ble", "rssi" to result.rssi),
          )
        }
      }
      scan = cb
      val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
      scanner.startScan(null, settings, cb)
    }

    Function("stopScan") { stopScan() }

    AsyncFunction("connect") { kind: String, id: String, promise: Promise ->
      closeLink()
      stopScan()
      val device = try {
        enabledAdapter().getRemoteDevice(id)
      } catch (e: IllegalArgumentException) {
        throw BluetoothError("Bad Bluetooth address: $id")
      }
      when (kind) {
        "classic" -> ClassicLink(device).also { connecting(it) }.open(promise)
        "ble" -> BleLink(device).also { connecting(it) }.open(promise)
        else -> throw BluetoothError("Unknown Bluetooth kind: $kind")
      }
    }

    AsyncFunction("write") { data: String, promise: Promise ->
      val l = link ?: throw BluetoothError("Not connected")
      l.write(data.toByteArray(Charsets.ISO_8859_1), promise)
    }

    Function("disconnect") { closeLink() }

    OnDestroy {
      stopScan()
      closeLink()
    }
  }

  private fun stopScan() {
    val cb = scan ?: return
    scan = null
    try {
      adapter().bluetoothLeScanner?.stopScan(cb)
    } catch (_: Exception) {
      // Bluetooth turned off meanwhile: the scan is gone anyway
    }
  }

  @Synchronized
  private fun connecting(l: Link) {
    pending = l
  }

  @Synchronized
  private fun closeLink() {
    val l = link
    val p = pending
    link = null
    pending = null
    l?.close()
    p?.close()
  }

  /** An open link dropped by itself (not via disconnect/connect). */
  @Synchronized
  private fun dropped(l: Link, reason: String?) {
    if (link !== l) return
    link = null
    l.close()
    sendEvent("onClose", mapOf("error" to reason))
  }

  /** False when the connect was cancelled (disconnect or a newer connect) meanwhile. */
  @Synchronized
  private fun opened(l: Link): Boolean {
    if (pending !== l) return false
    pending = null
    link = l
    return true
  }

  private fun emitData(bytes: ByteArray, count: Int = bytes.size) {
    if (count > 0) sendEvent("onData", mapOf("data" to String(bytes, 0, count, Charsets.ISO_8859_1)))
  }

  // -------------------------------------------------------------------------
  // Classic: RFCOMM socket with a blocking reader thread
  // -------------------------------------------------------------------------
  private inner class ClassicLink(private val device: BluetoothDevice) : Link {
    @Volatile private var socket: BluetoothSocket? = null
    @Volatile private var closed = false

    fun open(promise: Promise) {
      thread(name = "obd-bt-classic") {
        val s = try {
          adapter().cancelDiscovery() // discovery slows RFCOMM connects to a crawl
          connectSocket()
        } catch (e: Exception) {
          promise.reject("ERR_BT_CONNECT", "Could not connect to ${device.address}: ${e.message}", e)
          return@thread
        }
        socket = s
        if (closed || !opened(this)) {
          close()
          promise.reject("ERR_BT_CONNECT", "Connection cancelled", null)
          return@thread
        }
        promise.resolve()
        read(s)
      }
    }

    private fun connectSocket(): BluetoothSocket {
      val first = device.createRfcommSocketToServiceRecord(SPP_UUID)
      try {
        first.connect()
        return first
      } catch (e: IOException) {
        try {
          first.close()
        } catch (_: IOException) {}
        // Many ELM327 clones advertise SPP badly; channel 1 directly is the
        // well-known workaround.
        val fallback = device.javaClass
          .getMethod("createRfcommSocket", Int::class.javaPrimitiveType)
          .invoke(device, 1) as BluetoothSocket
        try {
          fallback.connect()
        } catch (e2: IOException) {
          try {
            fallback.close()
          } catch (_: IOException) {}
          throw e
        }
        return fallback
      }
    }

    private fun read(s: BluetoothSocket) {
      val buf = ByteArray(1024)
      try {
        val input = s.inputStream
        while (!closed) {
          val n = input.read(buf)
          if (n < 0) break
          emitData(buf, n)
        }
        dropped(this, "Dongle closed the connection")
      } catch (e: IOException) {
        dropped(this, e.message)
      }
    }

    override fun write(bytes: ByteArray, promise: Promise) {
      val s = socket ?: return promise.reject("ERR_BT_WRITE", "Not connected", null)
      try {
        s.outputStream.write(bytes)
        s.outputStream.flush()
        promise.resolve()
      } catch (e: IOException) {
        promise.reject("ERR_BT_WRITE", e.message, e)
        dropped(this, e.message)
      }
    }

    override fun close() {
      closed = true
      try {
        socket?.close()
      } catch (_: IOException) {}
    }
  }

  // -------------------------------------------------------------------------
  // BLE: GATT notifications in, characteristic writes out
  // -------------------------------------------------------------------------
  private inner class BleLink(private val device: BluetoothDevice) : Link {
    private var gatt: BluetoothGatt? = null
    private var tx: BluetoothGattCharacteristic? = null
    private var connecting: Promise? = null
    private var pendingWrite: Promise? = null
    @Volatile private var closed = false

    private val callback = object : BluetoothGattCallback() {
      override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
        if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
          g.requestConnectionPriority(BluetoothGatt.CONNECTION_PRIORITY_HIGH)
          if (!g.discoverServices()) fail("Service discovery failed to start")
        } else if (newState == BluetoothProfile.STATE_DISCONNECTED || status != BluetoothGatt.GATT_SUCCESS) {
          fail("Disconnected (GATT status $status)")
        }
      }

      override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
        if (status != BluetoothGatt.GATT_SUCCESS) return fail("Service discovery failed ($status)")
        val (rx, w) = pickSerial(g.services) ?: return fail("No serial service found on this device")
        tx = w
        g.setCharacteristicNotification(rx, true)
        val cccd = rx.getDescriptor(CCCD_UUID) ?: return ready()
        val value =
          if (rx.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) {
            BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
          } else {
            BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
          }
        val started =
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeDescriptor(cccd, value) == BluetoothGatt.GATT_SUCCESS
          } else {
            @Suppress("DEPRECATION")
            cccd.value = value
            @Suppress("DEPRECATION")
            g.writeDescriptor(cccd)
          }
        if (!started) fail("Could not enable notifications")
      }

      override fun onDescriptorWrite(g: BluetoothGatt, d: BluetoothGattDescriptor, status: Int) {
        if (status == BluetoothGatt.GATT_SUCCESS) ready() else fail("Could not enable notifications ($status)")
      }

      override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) {
        emitData(value)
      }

      @Deprecated("Called instead of the ByteArray overload before Android 13")
      override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
        @Suppress("DEPRECATION")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) emitData(c.value ?: return)
      }

      override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
        val p = pendingWrite ?: return
        pendingWrite = null
        if (status == BluetoothGatt.GATT_SUCCESS) p.resolve() else p.reject("ERR_BT_WRITE", "Write failed ($status)", null)
      }
    }

    fun open(promise: Promise) {
      connecting = promise
      gatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
        ?: return fail("Could not start a BLE connection")
    }

    @Synchronized
    private fun ready() {
      val p = connecting ?: return
      connecting = null
      if (closed || !opened(this)) {
        close()
        p.reject("ERR_BT_CONNECT", "Connection cancelled", null)
      } else {
        p.resolve()
      }
    }

    @Synchronized
    private fun fail(reason: String) {
      val p = connecting
      connecting = null
      if (p != null) {
        close()
        p.reject("ERR_BT_CONNECT", "Could not connect to ${device.address}: $reason", null)
      } else {
        pendingWrite?.reject("ERR_BT_WRITE", reason, null)
        pendingWrite = null
        dropped(this, reason)
      }
    }

    override fun write(bytes: ByteArray, promise: Promise) {
      val g = gatt
      val c = tx
      if (g == null || c == null) return promise.reject("ERR_BT_WRITE", "Not connected", null)
      if (bytes.size > BLE_MAX_WRITE) return promise.reject("ERR_BT_WRITE", "Command too long for BLE", null)
      val noResponse = c.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0
      val type =
        if (noResponse) BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE else BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
      if (!noResponse) {
        pendingWrite?.reject("ERR_BT_WRITE", "Superseded", null)
        pendingWrite = promise
      }
      val ok =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          g.writeCharacteristic(c, bytes, type) == BluetoothGatt.GATT_SUCCESS
        } else {
          @Suppress("DEPRECATION")
          c.writeType = type
          @Suppress("DEPRECATION")
          c.value = bytes
          @Suppress("DEPRECATION")
          g.writeCharacteristic(c)
        }
      if (!ok) {
        if (!noResponse) pendingWrite = null
        promise.reject("ERR_BT_WRITE", "BLE write was refused", null)
      } else if (noResponse) {
        promise.resolve()
      }
    }

    override fun close() {
      closed = true
      val g = gatt
      gatt = null
      try {
        g?.disconnect()
        g?.close()
      } catch (_: Exception) {}
    }
  }

  /** The notify (rx) and write (tx) characteristics of the dongle's serial service. */
  private fun pickSerial(
    services: List<BluetoothGattService>,
  ): Pair<BluetoothGattCharacteristic, BluetoothGattCharacteristic>? {
    val ordered =
      services.filter { it.uuid in KNOWN_SERVICES }.sortedBy { KNOWN_SERVICES.indexOf(it.uuid) } +
        services.filter { it.uuid !in KNOWN_SERVICES && it.uuid !in STANDARD_SERVICES }
    for (s in ordered) {
      val chars = s.characteristics
      val notifies = BluetoothGattCharacteristic.PROPERTY_NOTIFY or BluetoothGattCharacteristic.PROPERTY_INDICATE
      val writes = BluetoothGattCharacteristic.PROPERTY_WRITE or BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE
      val rx = chars.firstOrNull { it.properties and notifies != 0 } ?: continue
      val tx = chars.firstOrNull { it !== rx && it.properties and writes != 0 }
        ?: rx.takeIf { it.properties and writes != 0 }
        ?: continue
      return rx to tx
    }
    return null
  }
}
