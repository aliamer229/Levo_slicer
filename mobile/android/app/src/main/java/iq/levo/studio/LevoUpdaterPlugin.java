package iq.levo.studio;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "LevoUpdater")
public class LevoUpdaterPlugin extends Plugin {
    private static final String ORIGIN = "https://levo-web-slicer.aliamer59409.chatgpt.site";
    private static final String MANIFEST_URL = ORIGIN + "/downloads/levo-studio-android.json";
    private static final long MAX_APK_BYTES = 300L * 1024L * 1024L;
    private final ExecutorService queue = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void checkForUpdate(PluginCall call) {
        queue.execute(() -> {
            try {
                Update update = readUpdate();
                call.resolve(update.toJson(currentVersionCode(), currentVersionName()));
            } catch (Exception error) {
                call.reject("Could not check for LEVO Studio updates.", error);
            }
        });
    }

    @PluginMethod
    public void installUpdate(PluginCall call) {
        queue.execute(() -> {
            try {
                Update update = readUpdate();
                if (update.versionCode <= currentVersionCode()) {
                    call.reject("LEVO Studio is already up to date.");
                    return;
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                    permission.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(permission);
                    call.reject("Allow LEVO Studio to install updates, then tap Update again.");
                    return;
                }

                File directory = new File(getContext().getCacheDir(), "levo-updates");
                if (!directory.mkdirs() && !directory.isDirectory()) throw new IllegalStateException("Update cache unavailable.");
                File apk = new File(directory, "LEVO-Studio-update.apk");
                download(update.downloadUrl, apk, update.sizeBytes);
                if (!digest(apk).equalsIgnoreCase(update.sha256)) {
                    apk.delete();
                    throw new SecurityException("Update checksum mismatch.");
                }

                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent installer = new Intent(Intent.ACTION_VIEW);
                installer.setDataAndType(uri, "application/vnd.android.package-archive");
                installer.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getContext().startActivity(installer);
                JSObject result = new JSObject();
                result.put("installerOpened", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("The LEVO Studio update could not be verified or installed.", error);
            }
        });
    }

    private Update readUpdate() throws Exception {
        HttpURLConnection connection = open(MANIFEST_URL);
        try {
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IllegalStateException("Update manifest returned HTTP " + status + ".");
            byte[] bytes = readBounded(connection.getInputStream(), 64 * 1024);
            JSONObject manifest = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            String file = manifest.getString("file");
            if (!file.matches("LEVO-Studio-Android-v[0-9.]+\\.apk")) throw new SecurityException("Invalid update filename.");
            String sha256 = manifest.getString("sha256");
            if (!sha256.matches("[a-fA-F0-9]{64}")) throw new SecurityException("Invalid update checksum.");
            long sizeBytes = manifest.getLong("sizeBytes");
            if (sizeBytes <= 0 || sizeBytes > MAX_APK_BYTES) throw new SecurityException("Invalid update size.");
            return new Update(
                manifest.getInt("versionCode"),
                manifest.getString("versionName"),
                sizeBytes,
                sha256,
                ORIGIN + "/downloads/" + file
            );
        } finally {
            connection.disconnect();
        }
    }

    private static HttpURLConnection open(String value) throws Exception {
        URL url = new URL(value);
        if (!"https".equals(url.getProtocol()) || !"levo-web-slicer.aliamer59409.chatgpt.site".equals(url.getHost())) {
            throw new SecurityException("Untrusted update origin.");
        }
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(30000);
        connection.setInstanceFollowRedirects(false);
        connection.setUseCaches(false);
        return connection;
    }

    private static void download(String url, File target, long expectedBytes) throws Exception {
        HttpURLConnection connection = open(url);
        try {
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) throw new IllegalStateException("Update download failed.");
            long announced = connection.getContentLengthLong();
            if (announced > 0 && announced != expectedBytes) throw new SecurityException("Update size changed.");
            long total = 0;
            try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(target, false)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    total += count;
                    if (total > MAX_APK_BYTES || total > expectedBytes) throw new SecurityException("Update is larger than expected.");
                    output.write(buffer, 0, count);
                }
            }
            if (total != expectedBytes) throw new SecurityException("Update download is incomplete.");
        } finally {
            connection.disconnect();
        }
    }

    private static byte[] readBounded(InputStream input, int limit) throws Exception {
        byte[] buffer = new byte[4096];
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        int total = 0;
        int count;
        while ((count = input.read(buffer)) != -1) {
            total += count;
            if (total > limit) throw new SecurityException("Update manifest is too large.");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private int currentVersionCode() throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return (int) getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).getLongVersionCode();
        }
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionCode;
    }

    private String currentVersionName() throws Exception {
        String value = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName;
        return value == null ? "" : value;
    }

    private static String digest(File file) throws Exception {
        MessageDigest messageDigest = MessageDigest.getInstance("SHA-256");
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) messageDigest.update(buffer, 0, count);
        }
        StringBuilder result = new StringBuilder();
        for (byte value : messageDigest.digest()) result.append(String.format("%02x", value));
        return result.toString();
    }

    private static final class Update {
        final int versionCode;
        final String versionName;
        final long sizeBytes;
        final String sha256;
        final String downloadUrl;

        Update(int versionCode, String versionName, long sizeBytes, String sha256, String downloadUrl) {
            this.versionCode = versionCode;
            this.versionName = versionName;
            this.sizeBytes = sizeBytes;
            this.sha256 = sha256;
            this.downloadUrl = downloadUrl;
        }

        JSObject toJson(int currentCode, String currentName) {
            JSObject result = new JSObject();
            result.put("currentVersionCode", currentCode);
            result.put("currentVersionName", currentName);
            result.put("latestVersionCode", versionCode);
            result.put("latestVersionName", versionName);
            result.put("sizeBytes", sizeBytes);
            result.put("available", versionCode > currentCode);
            return result;
        }
    }
}
