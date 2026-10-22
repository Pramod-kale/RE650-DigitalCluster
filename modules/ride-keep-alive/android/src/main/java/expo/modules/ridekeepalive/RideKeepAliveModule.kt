package expo.modules.ridekeepalive

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Keeps a ride recording while the phone is in a pocket or another app is in
 * front. The process itself is kept alive by expo-location's foreground
 * service; this module keeps it doing work:
 *  - React Native stops JS timers in the background unless a headless JS task
 *    is active (JavaTimerManager), which would freeze the OBD poll loop.
 *  - With the screen off the CPU may sleep between GPS fixes (most likely
 *    during a stop), so a partial wake lock is held for the ride.
 *  - A Wi-Fi lock stops Wi-Fi power saving from delaying OBD replies.
 */
class RideKeepAliveModule : Module() {
  private var taskId: Int? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var wifiLock: WifiManager.WifiLock? = null

  private val context: Context?
    get() = appContext.reactContext

  private fun headless(): HeadlessJsTaskContext? =
    (appContext.reactContext as? ReactContext)?.let { HeadlessJsTaskContext.getInstance(it) }

  override fun definition() = ModuleDefinition {
    Name("RideKeepAlive")

    Function("start") { taskKey: String ->
      synchronized(this@RideKeepAliveModule) { acquireLocks() }
      // startTask must run on the UI thread.
      UiThreadUtil.runOnUiThread {
        synchronized(this@RideKeepAliveModule) {
          if (taskId == null) {
            taskId = headless()?.startTask(
              HeadlessJsTaskConfig(taskKey, Arguments.createMap(), 0, true)
            )
          }
        }
      }
    }

    Function("stop") {
      synchronized(this@RideKeepAliveModule) {
        taskId?.let { id -> headless()?.finishTask(id) }
        taskId = null
        releaseLocks()
      }
    }

    /** True when Android won't put the app to sleep (Doze / app standby). */
    Function("isIgnoringBatteryOptimizations") {
      val ctx = context ?: return@Function false
      ctx.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(ctx.packageName) == true
    }

    /** Shows the system "Let app always run in background?" dialog. */
    Function("requestIgnoreBatteryOptimizations") {
      context?.let { ctx ->
        @SuppressLint("BatteryLife") // a ride logger has to run with the screen off
        val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
          .setData(Uri.parse("package:${ctx.packageName}"))
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(intent)
      }
      null
    }

    OnDestroy {
      synchronized(this@RideKeepAliveModule) { releaseLocks() }
    }
  }

  @SuppressLint("WakelockTimeout") // released when the ride closes; length is unknown
  private fun acquireLocks() {
    val ctx = context ?: return
    if (wakeLock == null) {
      wakeLock = ctx.getSystemService(PowerManager::class.java)
        ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RE650Cluster:ride")
        ?.apply {
          setReferenceCounted(false)
          acquire()
        }
    }
    if (wifiLock == null) {
      val mode =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          WifiManager.WIFI_MODE_FULL_LOW_LATENCY
        } else {
          @Suppress("DEPRECATION")
          WifiManager.WIFI_MODE_FULL_HIGH_PERF
        }
      wifiLock = ctx.applicationContext.getSystemService(WifiManager::class.java)
        ?.createWifiLock(mode, "RE650Cluster:obd")
        ?.apply {
          setReferenceCounted(false)
          acquire()
        }
    }
  }

  private fun releaseLocks() {
    wakeLock?.takeIf { it.isHeld }?.release()
    wakeLock = null
    wifiLock?.takeIf { it.isHeld }?.release()
    wifiLock = null
  }
}
