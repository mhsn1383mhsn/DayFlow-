const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const main = path.join(root, 'android', 'app', 'src', 'main');
const manifestPath = path.join(main, 'AndroidManifest.xml');
const pkg = 'app.dayflow.planner';
const javaDir = path.join(main, 'java', ...pkg.split('.'));
fs.mkdirSync(javaDir, { recursive: true });

// ---- Manifest ----
let xml = fs.readFileSync(manifestPath, 'utf8');
const permissions = [
  'POST_NOTIFICATIONS','SCHEDULE_EXACT_ALARM','VIBRATE','WAKE_LOCK','RECEIVE_BOOT_COMPLETED',
  'READ_CALENDAR','WRITE_CALENDAR','USE_FULL_SCREEN_INTENT',
  'FOREGROUND_SERVICE','FOREGROUND_SERVICE_MEDIA_PLAYBACK'
];
for (const p of permissions) {
  if (!xml.includes(`android.permission.${p}`)) {
    xml = xml.replace('<application', `<uses-permission android:name="android.permission.${p}" />\n\n    <application`);
  }
}
if (!xml.includes('DayFlowAlarmReceiver')) {
  xml = xml.replace('</application>', `
        <receiver android:name=".DayFlowAlarmReceiver" android:exported="false" />
        <receiver android:name=".DayFlowBootReceiver" android:exported="false">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
        <service
            android:name=".DayFlowAlarmService"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
    </application>`);
}
fs.writeFileSync(manifestPath, xml);

// ---- Notification icon ----
const drawableDir = path.join(main, 'res', 'drawable');
fs.mkdirSync(drawableDir, { recursive: true });
fs.writeFileSync(path.join(drawableDir, 'ic_stat_dayflow.xml'), `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFFFF" android:pathData="M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.9,2 2,2zM18,16v-5c0,-3.07 -1.63,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5S10.5,3.17 10.5,4v0.68C7.64,5.36 6,7.92 6,11v5l-2,2v1h16v-1z" />
</vector>`);

// ---- Stable debug signing ----
const gradlePath = path.join(root, 'android', 'app', 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
if (!gradle.includes('dayflow-debug.keystore')) {
  gradle = gradle.replace(/android\s*\{/, `android {
    signingConfigs {
        debug {
            storeFile file('../../keystore/dayflow-debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`);
  gradle = gradle.replace(/buildTypes\s*\{/, `buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }`);
  gradle += `

tasks.withType(JavaCompile).configureEach {
    options.encoding = 'UTF-8'
}
`;
  fs.writeFileSync(gradlePath, gradle);
}

// ---- Direct Android Calendar plugin ----
fs.writeFileSync(path.join(javaDir, 'DayFlowCalendarPlugin.java'), `package ${pkg};

import android.Manifest;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "DayFlowCalendar", permissions = {
    @Permission(alias = "calendar", strings = { Manifest.permission.READ_CALENDAR, Manifest.permission.WRITE_CALENDAR })
})
public class DayFlowCalendarPlugin extends Plugin {
    @PluginMethod
    public void addEvent(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "calendarPermissionResult");
            return;
        }
        writeEvent(call);
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void calendarPermissionResult(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) writeEvent(call);
        else call.reject("اجازه دسترسی به تقویم داده نشد");
    }

    private long findWritableCalendar() {
        Cursor c = null;
        try {
            String[] projection = { CalendarContract.Calendars._ID, CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
                    CalendarContract.Calendars.VISIBLE, CalendarContract.Calendars.ACCOUNT_TYPE };
            String selection = CalendarContract.Calendars.VISIBLE + "=1 AND " +
                    CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL + ">=" + CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR;
            c = getContext().getContentResolver().query(CalendarContract.Calendars.CONTENT_URI, projection, selection, null, null);
            if (c == null) return -1;
            long fallback = -1;
            int idCol = c.getColumnIndex(CalendarContract.Calendars._ID);
            int typeCol = c.getColumnIndex(CalendarContract.Calendars.ACCOUNT_TYPE);
            while (c.moveToNext()) {
                long id = c.getLong(idCol);
                String type = typeCol >= 0 ? c.getString(typeCol) : "";
                if ("LOCAL".equalsIgnoreCase(type)) return id;
                if (fallback < 0) fallback = id;
            }
            return fallback;
        } finally {
            if (c != null) c.close();
        }
    }

    private void writeEvent(PluginCall call) {
        try {
            String title = call.getString("title", "DayFlow");
            String description = call.getString("description", "");
            long start = call.getLong("start", 0L);
            long end = call.getLong("end", start + 1800000L);
            boolean allDay = Boolean.TRUE.equals(call.getBoolean("allDay", false));
            String rrule = call.getString("rrule", "");
            long eventId = call.getLong("eventId", -1L);
            long calendarId = call.getLong("calendarId", -1L);
            if (calendarId < 0) calendarId = findWritableCalendar();
            if (calendarId < 0) { call.reject("هیچ تقویم قابل ویرایشی روی گوشی پیدا نشد"); return; }

            boolean recurring = rrule != null && !rrule.isEmpty();
            long dtStart = start;
            long dtEnd = end > start ? end : start + 1800000L;
            String tz = java.util.TimeZone.getDefault().getID();
            long days = 1;
            if (allDay) {
                // Android requires all-day events to start/end at UTC midnight
                java.util.Calendar lc = java.util.Calendar.getInstance();
                lc.setTimeInMillis(start);
                java.util.Calendar u = java.util.Calendar.getInstance(java.util.TimeZone.getTimeZone("UTC"));
                u.clear();
                u.set(lc.get(java.util.Calendar.YEAR), lc.get(java.util.Calendar.MONTH), lc.get(java.util.Calendar.DAY_OF_MONTH));
                dtStart = u.getTimeInMillis();
                days = Math.max(1L, Math.round((end - start) / 86400000.0));
                dtEnd = dtStart + days * 86400000L;
                tz = "UTC";
            }

            ContentValues values = new ContentValues();
            values.put(CalendarContract.Events.CALENDAR_ID, calendarId);
            values.put(CalendarContract.Events.TITLE, title);
            values.put(CalendarContract.Events.DESCRIPTION, description);
            values.put(CalendarContract.Events.DTSTART, dtStart);
            values.put(CalendarContract.Events.EVENT_TIMEZONE, tz);
            values.put(CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
            if (recurring) {
                // recurring events must use DURATION (no DTEND)
                String dur = allDay ? "P" + days + "D" : "P" + Math.max(60L, (dtEnd - dtStart) / 1000L) + "S";
                values.put(CalendarContract.Events.RRULE, rrule);
                values.put(CalendarContract.Events.DURATION, dur);
                values.putNull(CalendarContract.Events.DTEND);
            } else {
                values.put(CalendarContract.Events.DTEND, dtEnd);
                values.putNull(CalendarContract.Events.RRULE);
                values.putNull(CalendarContract.Events.DURATION);
            }

            Uri uri = null;
            if (eventId > 0) {
                Uri existing = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId);
                int updated = getContext().getContentResolver().update(existing, values, null, null);
                if (updated > 0) {
                    uri = existing;
                    getContext().getContentResolver().delete(CalendarContract.Reminders.CONTENT_URI,
                            CalendarContract.Reminders.EVENT_ID + "=?", new String[]{ String.valueOf(eventId) });
                }
            }
            if (uri == null) {
                uri = getContext().getContentResolver().insert(CalendarContract.Events.CONTENT_URI, values);
            }
            if (uri == null) { call.reject("ثبت رویداد در تقویم انجام نشد"); return; }
            long newId = ContentUris.parseId(uri);
            JSArray reminders = call.getArray("reminders");
            if (reminders == null || reminders.length() == 0) {
                reminders = new JSArray();
                reminders.put(0);
            }
            for (int i = 0; i < reminders.length(); i++) {
                ContentValues rv = new ContentValues();
                rv.put(CalendarContract.Reminders.EVENT_ID, newId);
                rv.put(CalendarContract.Reminders.MINUTES, Math.max(0, reminders.getInt(i)));
                rv.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                getContext().getContentResolver().insert(CalendarContract.Reminders.CONTENT_URI, rv);
            }
            JSObject out = new JSObject();
            out.put("eventId", newId);
            out.put("calendarId", calendarId);
            call.resolve(out);
        } catch (Exception e) {
            call.reject("خطا در ثبت مستقیم رویداد تقویم", e);
        }
    }

    @PluginMethod
    public void deleteEvent(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) { call.resolve(); return; }
        try {
            long eventId = call.getLong("eventId", -1L);
            if (eventId > 0) getContext().getContentResolver().delete(
                    ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId), null, null);
            call.resolve();
        } catch (Exception e) { call.reject("حذف رویداد انجام نشد", e); }
    }
}
`);

// ---- Native notification / sound / exact alarm bridge ----
fs.writeFileSync(path.join(javaDir, 'DayFlowNativePlugin.java'), `package ${pkg};

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "DayFlowNative")
public class DayFlowNativePlugin extends Plugin {
    private static final String PREF = "dayflow_native";
    private SharedPreferences prefs() { return getContext().getSharedPreferences(PREF, Context.MODE_PRIVATE); }

    private Uri selectedSound(String kind) {
        // Prefer original content:// ringtone URI — system NotificationManager can read it
        String s = prefs().getString("alarm".equals(kind) ? "alarmSound" : "notificationSound", "");
        if (s != null && !s.isEmpty()) return Uri.parse(s);
        String local = prefs().getString("alarm".equals(kind) ? "alarmSoundLocal" : "notificationSoundLocal", "");
        if (local != null && !local.isEmpty()) {
            java.io.File f = new java.io.File(local);
            if (f.exists() && f.length() > 0) return Uri.fromFile(f);
        }
        return null;
    }

    public void ensureChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel("dayflow-alerts") == null) createChannel("dayflow-alerts", "اعلان‌های DayFlow", "notification");
        if (nm.getNotificationChannel("dayflow-alarms") == null) createChannel("dayflow-alarms", "زنگ‌های DayFlow", "alarm");
    }

    /** Always delete + recreate so custom ringtone is applied (Android freezes channel sound after create). */
    public void forceRecreateChannels() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        try { nm.deleteNotificationChannel("dayflow-alerts"); } catch (Exception ignored) {}
        try { nm.deleteNotificationChannel("dayflow-alarms"); } catch (Exception ignored) {}
        createChannel("dayflow-alerts", "اعلان‌های DayFlow", "notification");
        createChannel("dayflow-alarms", "زنگ‌های DayFlow", "alarm");
    }

    private void createChannel(String id, String name, String kind) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        boolean isAlarm = "alarm".equals(kind);
        int importance = isAlarm ? NotificationManager.IMPORTANCE_HIGH : NotificationManager.IMPORTANCE_HIGH;
        NotificationChannel channel = new NotificationChannel(id, name, importance);
        channel.enableVibration(true);
        channel.setVibrationPattern(new long[]{0,350,180,350,180,700});
        channel.setLockscreenVisibility(android.app.Notification.VISIBILITY_PUBLIC);
        channel.enableLights(true);
        channel.setLightColor(isAlarm ? 0xFFFFB020 : 0xFF178BFF);
        channel.setBypassDnd(isAlarm);
        if (isAlarm) {
            // Alarm audio is played by DayFlowAlarmService (MediaPlayer). Keep channel silent to avoid short system blip.
            channel.setSound(null, null);
        } else {
            Uri sound = selectedSound(kind);
            Uri fallback = Settings.System.DEFAULT_NOTIFICATION_URI;
            Uri use = sound != null ? sound : fallback;
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            try { channel.setSound(use, attrs); } catch (Exception e) { channel.setSound(fallback, attrs); }
        }
        nm.createNotificationChannel(channel);
    }

    private JSObject statusObject() {
        JSObject o = new JSObject();
        boolean enabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        o.put("notificationsEnabled", enabled);
        AlarmManager am = (AlarmManager)getContext().getSystemService(Context.ALARM_SERVICE);
        boolean exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms();
        o.put("exactAlarmAllowed", exact);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = (NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel a = nm.getNotificationChannel("dayflow-alerts");
            NotificationChannel b = nm.getNotificationChannel("dayflow-alarms");
            o.put("alertChannelEnabled", a == null || a.getImportance() != NotificationManager.IMPORTANCE_NONE);
            o.put("alarmChannelEnabled", b == null || b.getImportance() != NotificationManager.IMPORTANCE_NONE);
        } else {
            o.put("alertChannelEnabled", enabled);
            o.put("alarmChannelEnabled", enabled);
        }
        o.put("notificationSound", prefs().getString("notificationSound", ""));
        o.put("alarmSound", prefs().getString("alarmSound", ""));
        return o;
    }

    @PluginMethod public void init(PluginCall call) { ensureChannels(); call.resolve(statusObject()); }
    @PluginMethod public void status(PluginCall call) { ensureChannels(); call.resolve(statusObject()); }
    @PluginMethod public void ping(PluginCall call) {
        JSObject o = new JSObject();
        o.put("ok", true);
        o.put("plugin", "DayFlowNative");
        o.put("version", 2);
        call.resolve(o);
    }

    @PluginMethod public void openNotificationSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i); call.resolve();
        } catch (Exception e) { call.reject("باز کردن تنظیمات اعلان ممکن نشد", e); }
    }

    @PluginMethod public void openExactAlarmSettings(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i); call.resolve();
        } catch (Exception e) { call.reject("باز کردن تنظیمات آلارم دقیق ممکن نشد", e); }
    }

    @PluginMethod public void pickSound(PluginCall call) {
        String kind = call.getString("kind", "notification");
        Intent i = new Intent(RingtoneManager.ACTION_RINGTONE_PICKER);
        int type = "alarm".equals(kind) ? RingtoneManager.TYPE_ALARM : RingtoneManager.TYPE_NOTIFICATION;
        i.putExtra(RingtoneManager.EXTRA_RINGTONE_TYPE, type);
        i.putExtra(RingtoneManager.EXTRA_RINGTONE_TITLE, "alarm".equals(kind) ? "انتخاب صدای آلارم" : "انتخاب صدای اعلان");
        i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_SILENT, false);
        i.putExtra(RingtoneManager.EXTRA_RINGTONE_SHOW_DEFAULT, true);
        Uri existing = selectedSound(kind);
        if (existing != null) {
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, existing);
        } else {
            Uri def = "alarm".equals(kind) ? Settings.System.DEFAULT_ALARM_ALERT_URI : Settings.System.DEFAULT_NOTIFICATION_URI;
            i.putExtra(RingtoneManager.EXTRA_RINGTONE_EXISTING_URI, def);
        }
        // keep kind on the call so the callback can read it
        call.setKeepAlive(true);
        startActivityForResult(call, i, "soundPicked");
    }

    @ActivityCallback
    private void soundPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            if (result == null || result.getResultCode() != android.app.Activity.RESULT_OK) {
                call.reject("انتخاب صدا لغو شد"); return;
            }
            Intent data = result.getData();
            Uri u = null;
            if (data != null) {
                // Ringtone picker returns EXTRA_RINGTONE_PICKED_URI; document picker returns getData()
                u = data.getParcelableExtra(RingtoneManager.EXTRA_RINGTONE_PICKED_URI);
                if (u == null) u = data.getData();
            }
            String kind = call.getString("kind", "notification");
            String key = "alarm".equals(kind) ? "alarmSound" : "notificationSound";
            String localKey = "alarm".equals(kind) ? "alarmSoundLocal" : "notificationSoundLocal";
            if (u == null) {
                prefs().edit().remove(key).remove(localKey).apply();
            } else {
                try { getContext().getContentResolver().takePersistableUriPermission(u, Intent.FLAG_GRANT_READ_URI_PERMISSION); } catch (Exception ignored) {}
                prefs().edit().putString(key, u.toString()).apply();
                // Copy to app-private file so MediaPlayer/channel can always read it
                try {
                    java.io.InputStream in = getContext().getContentResolver().openInputStream(u);
                    if (in != null) {
                        java.io.File out = new java.io.File(getContext().getFilesDir(), "alarm".equals(kind) ? "alarm_sound.bin" : "notif_sound.bin");
                        java.io.FileOutputStream fos = new java.io.FileOutputStream(out);
                        byte[] buf = new byte[8192];
                        int n;
                        while ((n = in.read(buf)) > 0) fos.write(buf, 0, n);
                        fos.flush(); fos.close(); in.close();
                        prefs().edit().putString(localKey, out.getAbsolutePath()).apply();
                    }
                } catch (Exception copyEx) {
                    prefs().edit().remove(localKey).apply();
                }
            }
            forceRecreateChannels();
            call.resolve(statusObject());
        } catch (Exception e) { call.reject("انتخاب فایل صدا انجام نشد", e); }
    }

    @PluginMethod public void resetSound(PluginCall call) {
        String kind = call.getString("kind", "notification");
        String key = "alarm".equals(kind) ? "alarmSound" : "notificationSound";
        String localKey = "alarm".equals(kind) ? "alarmSoundLocal" : "notificationSoundLocal";
        String localPath = prefs().getString(localKey, "");
        prefs().edit().remove(key).remove(localKey).apply();
        try { if (localPath != null && !localPath.isEmpty()) new java.io.File(localPath).delete(); } catch (Exception ignored) {}
        forceRecreateChannels();
        call.resolve(statusObject());
    }

    @PluginMethod public void applySounds(PluginCall call) {
        forceRecreateChannels();
        call.resolve(statusObject());
    }

    @PluginMethod public void stopAlarmSound(PluginCall call) {
        try { DayFlowAlarmService.stop(getContext()); } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod public void playTestSound(PluginCall call) {
        try {
            DayFlowAlarmService.start(getContext(), "تست صدا");
            call.resolve();
        } catch (Exception e) { call.reject("پخش تست ممکن نشد", e); }
    }

    @PluginMethod public void scheduleAlarms(PluginCall call) {
        try {
            ensureChannels();
            JSArray arr = call.getArray("alarms");
            String json = arr == null ? "[]" : arr.toString();
            AlarmManager am = (AlarmManager)getContext().getSystemService(Context.ALARM_SERVICE);
            // cancel previously scheduled alarms so deleted/disabled ones never fire
            try {
                org.json.JSONArray old = new org.json.JSONArray(prefs().getString("scheduledAlarms", "[]"));
                for (int i=0; i<old.length(); i++) {
                    org.json.JSONObject o = old.getJSONObject(i);
                    DayFlowAlarmReceiver.cancel(getContext(), o.optString("id", "alarm-"+i));
                }
            } catch (Exception ignored) {}
            prefs().edit().putString("scheduledAlarms", json).apply();
            if (arr != null) {
                for (int i=0; i<arr.length(); i++) {
                    org.json.JSONObject raw = arr.getJSONObject(i);
                    if (raw == null) continue;
                    DayFlowAlarmReceiver.schedule(getContext(), raw.optString("id", "alarm-"+i),
                            raw.optString("title", "زنگ"), raw.optLong("at", System.currentTimeMillis()+1000));
                }
            }
            call.resolve();
        } catch (Exception e) { call.reject("زمان‌بندی زنگ انجام نشد", e); }
    }
}
`);

// ---- Alarm foreground service (reliable looping sound + sticky notification) ----
fs.writeFileSync(path.join(javaDir, 'DayFlowAlarmService.java'), `package ${pkg};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.app.NotificationCompat;

public class DayFlowAlarmService extends Service {
    public static final String ACTION_START = "${pkg}.ALARM_START";
    public static final String ACTION_STOP = "${pkg}.ALARM_STOP";
    private static final String PREF = "dayflow_native";
    private static final int NOTIF_ID = 71001;
    private MediaPlayer player;
    private PowerManager.WakeLock wakeLock;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            shutdown();
            return START_NOT_STICKY;
        }
        String title = intent != null ? intent.getStringExtra("alarm_title") : null;
        if (title == null || title.isEmpty()) title = "زنگ";
        ensureSilentAlarmChannel();
        Notification n = buildNotification(title);
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, n);
        }
        startPlayer();
        return START_STICKY;
    }

    private void ensureSilentAlarmChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        // Delete and recreate without sound so only MediaPlayer is heard (no short system blip)
        try { nm.deleteNotificationChannel("dayflow-alarms"); } catch (Exception ignored) {}
        NotificationChannel ch = new NotificationChannel("dayflow-alarms", "زنگ‌های DayFlow", NotificationManager.IMPORTANCE_HIGH);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[]{0, 400, 200, 400, 200, 800});
        ch.setSound(null, null);
        ch.enableLights(true);
        ch.setLightColor(0xFFFFB020);
        ch.setBypassDnd(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private Uri resolveAlarmUri() {
        SharedPreferences sp = getSharedPreferences(PREF, MODE_PRIVATE);
        try {
            String local = sp.getString("alarmSoundLocal", "");
            if (local != null && !local.isEmpty()) {
                java.io.File f = new java.io.File(local);
                if (f.exists() && f.length() > 0) return Uri.fromFile(f);
            }
            String s = sp.getString("alarmSound", "");
            if (s != null && !s.isEmpty()) return Uri.parse(s);
        } catch (Exception ignored) {}
        return Settings.System.DEFAULT_ALARM_ALERT_URI;
    }

    private void startPlayer() {
        stopPlayerOnly();
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dayflow:alarmsvc");
            wakeLock.acquire(10 * 60 * 1000L);

            Uri uri = resolveAlarmUri();
            player = new MediaPlayer();
            player.setDataSource(this, uri);
            if (Build.VERSION.SDK_INT >= 21) {
                player.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build());
            } else {
                player.setAudioStreamType(AudioManager.STREAM_ALARM);
            }
            player.setLooping(true);
            player.setVolume(1f, 1f);
            player.setOnErrorListener((mp, what, extra) -> {
                stopPlayerOnly();
                return true;
            });
            player.prepare();
            player.start();
        } catch (Exception e) {
            stopPlayerOnly();
            // last resort: default alarm URI
            try {
                player = new MediaPlayer();
                player.setDataSource(this, Settings.System.DEFAULT_ALARM_ALERT_URI);
                if (Build.VERSION.SDK_INT >= 21) {
                    player.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build());
                } else {
                    player.setAudioStreamType(AudioManager.STREAM_ALARM);
                }
                player.setLooping(true);
                player.prepare();
                player.start();
            } catch (Exception ignored) {}
        }
    }

    private void stopPlayerOnly() {
        try {
            if (player != null) {
                if (player.isPlaying()) player.stop();
                player.release();
            }
        } catch (Exception ignored) {}
        player = null;
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {}
        wakeLock = null;
    }

    private Notification buildNotification(String title) {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("stop_alarm_sound", true);
        PendingIntent pi = PendingIntent.getActivity(this, 71002, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stop = new Intent(this, DayFlowAlarmService.class);
        stop.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 71003, stop,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, "dayflow-alarms")
                .setSmallIcon(R.drawable.ic_stat_dayflow)
                .setContentTitle("⏰ " + title)
                .setContentText("DayFlow — برای خاموش کردن لمس کن")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(true)
                .setSound(null)
                .setContentIntent(pi)
                .addAction(0, "خاموش کردن", stopPi)
                .setVibrate(new long[]{0, 400, 200, 400})
                .build();
    }

    private void shutdown() {
        stopPlayerOnly();
        try {
            stopForeground(true);
        } catch (Exception ignored) {}
        try {
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            nm.cancel(NOTIF_ID);
        } catch (Exception ignored) {}
        stopSelf();
    }

    @Override public void onDestroy() {
        stopPlayerOnly();
        super.onDestroy();
    }

    public static void start(Context c, String title) {
        Intent i = new Intent(c, DayFlowAlarmService.class);
        i.setAction(ACTION_START);
        i.putExtra("alarm_title", title == null ? "زنگ" : title);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    public static void stop(Context c) {
        try {
            Intent i = new Intent(c, DayFlowAlarmService.class);
            i.setAction(ACTION_STOP);
            c.startService(i);
        } catch (Exception e) {
            try {
                c.stopService(new Intent(c, DayFlowAlarmService.class));
            } catch (Exception ignored) {}
        }
    }
}
`);

// ---- Alarm receiver (starts/stops the service) ----
fs.writeFileSync(path.join(javaDir, 'DayFlowAlarmReceiver.java'), `package ${pkg};

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

public class DayFlowAlarmReceiver extends BroadcastReceiver {
    private static PendingIntent pending(Context c, String id, String title) {
        Intent i = new Intent(c, DayFlowAlarmReceiver.class);
        i.setAction("${pkg}.ALARM");
        i.putExtra("alarm_id", id);
        i.putExtra("alarm_title", title);
        int rid = id.hashCode() & 0x7fffffff;
        return PendingIntent.getBroadcast(c, rid, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void cancel(Context c, String id) {
        try {
            AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
            am.cancel(pending(c, id, ""));
        } catch (Exception ignored) {}
    }

    public static void schedule(Context c, String id, String title, long at) {
        if (at <= System.currentTimeMillis()) return;
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = pending(c, id, title);
        try {
            if (Build.VERSION.SDK_INT >= 31 && !am.canScheduleExactAlarms()) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else if (Build.VERSION.SDK_INT >= 23) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, at, pi);
            }
        } catch (SecurityException e) {
            if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
            else am.set(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    /** Compatibility for older plugin calls */
    public static void stopSound(Context c) {
        DayFlowAlarmService.stop(c);
    }

    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String act = intent.getAction();
        if ("${pkg}.STOP_SOUND".equals(act)) {
            DayFlowAlarmService.stop(context);
            return;
        }
        if (!"${pkg}.ALARM".equals(act)) return;
        String title = intent.getStringExtra("alarm_title");
        DayFlowAlarmService.start(context, title);
    }
}
`);



// ---- Restore alarm scheduling after reboot/update ----
fs.writeFileSync(path.join(javaDir, 'DayFlowBootReceiver.java'), `package ${pkg};

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

public class DayFlowBootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent in) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(in.getAction()) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(in.getAction())) return;
        try {
            JSONArray a = new JSONArray(c.getSharedPreferences("dayflow_native", Context.MODE_PRIVATE).getString("scheduledAlarms", "[]"));
            for (int i=0; i<a.length(); i++) {
                JSONObject o = a.getJSONObject(i);
                long at = o.optLong("at", 0);
                if (at <= System.currentTimeMillis()+3000) continue;
                DayFlowAlarmReceiver.schedule(c, o.optString("id", "alarm-"+i), o.optString("title", "زنگ"), at);
            }
        } catch (Exception ignored) {}
    }
}
`);

// ---- MainActivity: ALWAYS register custom plugins (must be before super.onCreate) ----
const mainActivity = path.join(javaDir, 'MainActivity.java');
const ma = `package ${pkg};

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DayFlowCalendarPlugin.class);
        registerPlugin(DayFlowNativePlugin.class);
        super.onCreate(savedInstanceState);
        stopAlarmIfNeeded(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        stopAlarmIfNeeded(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        // When user opens the app, stop looping alarm sound
        try { DayFlowAlarmService.stop(this); } catch (Exception ignored) {}
    }

    private void stopAlarmIfNeeded(Intent intent) {
        try {
            DayFlowAlarmService.stop(this);
            if (intent != null && intent.getBooleanExtra("stop_alarm_sound", false)) {
                android.app.NotificationManager nm = (android.app.NotificationManager)getSystemService(NOTIFICATION_SERVICE);
                if (nm != null) nm.cancelAll();
            }
        } catch (Exception ignored) {}
    }
}
`;
fs.writeFileSync(mainActivity, ma);

console.log('patch-android: OK');
