package iq.levo.studio;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "LevoPrinter")
public class LevoPrinterPlugin extends Plugin {
    private static final String UNAVAILABLE = "The Bambu LAN transport is not enabled in this bridge build.";
    private final ExecutorService queue = Executors.newSingleThreadExecutor();
    private final Map<String, Transfer> transfers = new ConcurrentHashMap<>();

    private static final class Transfer {
        final File directory;
        final long projectBytes;
        final long gcodeBytes;
        int nextProjectChunk;
        int nextGcodeChunk;

        Transfer(File directory, long projectBytes, long gcodeBytes) {
            this.directory = directory;
            this.projectBytes = projectBytes;
            this.gcodeBytes = gcodeBytes;
        }
    }

    @PluginMethod
    public void getEnvironment(PluginCall call) {
        JSObject capabilities = new JSObject();
        capabilities.put("discovery", false);
        capabilities.put("lanConnection", false);
        capabilities.put("telemetry", false);
        capabilities.put("packagePrintJob", false);
        capabilities.put("fileTransfer", false);
        capabilities.put("startPrint", false);
        JSObject result = new JSObject();
        result.put("native", true);
        result.put("platform", "android");
        result.put("bridgeVersion", "0.1.0");
        result.put("capabilities", capabilities);
        call.resolve(result);
    }

    @PluginMethod
    public void discoverPrinters(PluginCall call) {
        JSObject result = new JSObject();
        result.put("printers", new JSArray());
        call.resolve(result);
    }

    @PluginMethod
    public void connect(PluginCall call) { call.reject(UNAVAILABLE); }

    @PluginMethod
    public void disconnect(PluginCall call) {
        JSObject result = new JSObject();
        result.put("connected", false);
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("connected", false);
        result.put("state", "offline");
        call.resolve(result);
    }

    @PluginMethod
    public void beginPrintJob(PluginCall call) {
        Integer projectBytes = call.getInt("projectBytes");
        Integer gcodeBytes = call.getInt("gcodeBytes");
        if (projectBytes == null || gcodeBytes == null || projectBytes < 0 || gcodeBytes < 0) {
            call.reject("Invalid print-job sizes.");
            return;
        }
        queue.execute(() -> {
            String id = UUID.randomUUID().toString().toLowerCase();
            File directory = new File(getContext().getCacheDir(), "levo-print-transfers/" + id);
            if (!directory.mkdirs() && !directory.isDirectory()) {
                call.reject("Could not prepare the encrypted local transfer area.");
                return;
            }
            try {
                new File(directory, "project.3mf.part").createNewFile();
                new File(directory, "plate.gcode.part").createNewFile();
                transfers.put(id, new Transfer(directory, projectBytes.longValue(), gcodeBytes.longValue()));
                JSObject result = new JSObject();
                result.put("transferId", id);
                call.resolve(result);
            } catch (Exception error) {
                deleteRecursively(directory);
                call.reject("Could not prepare the local transfer area.", error);
            }
        });
    }

    @PluginMethod
    public void writePrintJobChunk(PluginCall call) {
        String transferId = call.getString("transferId");
        String asset = call.getString("asset");
        Integer index = call.getInt("index");
        String encoded = call.getString("base64");
        if (transferId == null || !("project".equals(asset) || "gcode".equals(asset)) || index == null || index < 0 || encoded == null) {
            call.reject("Invalid print-job chunk.");
            return;
        }
        queue.execute(() -> {
            Transfer transfer = transfers.get(transferId);
            if (transfer == null) {
                call.reject("Unknown or expired transfer.");
                return;
            }
            int expected = "project".equals(asset) ? transfer.nextProjectChunk : transfer.nextGcodeChunk;
            if (index != expected) {
                call.reject("Out-of-order print-job chunk.");
                return;
            }
            try {
                byte[] bytes = Base64.decode(encoded, Base64.NO_WRAP);
                File file = new File(transfer.directory, "project".equals(asset) ? "project.3mf.part" : "plate.gcode.part");
                try (FileOutputStream stream = new FileOutputStream(file, true)) {
                    stream.write(bytes);
                }
                if ("project".equals(asset)) transfer.nextProjectChunk += 1; else transfer.nextGcodeChunk += 1;
                JSObject result = new JSObject();
                result.put("accepted", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not stage the print-job chunk.", error);
            }
        });
    }

    @PluginMethod
    public void commitPrintJob(PluginCall call) {
        String transferId = call.getString("transferId");
        String projectSha256 = call.getString("projectSha256");
        String gcodeSha256 = call.getString("gcodeSha256");
        if (transferId == null || projectSha256 == null || gcodeSha256 == null) {
            call.reject("Missing print-job checksums.");
            return;
        }
        queue.execute(() -> {
            Transfer transfer = transfers.get(transferId);
            if (transfer == null) {
                call.reject("Unknown or expired transfer.");
                return;
            }
            try {
                File project = new File(transfer.directory, "project.3mf.part");
                File gcode = new File(transfer.directory, "plate.gcode.part");
                if (project.length() != transfer.projectBytes || gcode.length() != transfer.gcodeBytes
                    || !digest(project).equalsIgnoreCase(projectSha256)
                    || !digest(gcode).equalsIgnoreCase(gcodeSha256)) {
                    call.reject("Print-job checksum validation failed.");
                    return;
                }
                transfers.remove(transferId);
                deleteRecursively(transfer.directory);
                call.reject(UNAVAILABLE);
            } catch (Exception error) {
                call.reject("Could not validate the print job.", error);
            }
        });
    }

    @PluginMethod
    public void cancelPrintJob(PluginCall call) {
        String transferId = call.getString("transferId");
        queue.execute(() -> {
            Transfer transfer = transferId == null ? null : transfers.remove(transferId);
            if (transfer != null) deleteRecursively(transfer.directory);
            call.resolve();
        });
    }

    private static String digest(File file) throws Exception {
        byte[] bytes = Files.readAllBytes(file.toPath());
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder result = new StringBuilder(hash.length * 2);
        for (byte value : hash) result.append(String.format("%02x", value));
        return result.toString();
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        file.delete();
    }
}
