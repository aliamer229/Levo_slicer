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
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

@CapacitorPlugin(name = "LevoPrinter")
public class LevoPrinterPlugin extends Plugin {
    private static final String UNAVAILABLE = "Direct job upload requires a verified Bambu-compatible .gcode.3mf package.";
    private final ExecutorService queue = Executors.newSingleThreadExecutor();
    private final Map<String, Transfer> transfers = new ConcurrentHashMap<>();
    private volatile JSObject connectedPrinter;

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
        capabilities.put("discovery", true);
        capabilities.put("lanConnection", true);
        capabilities.put("telemetry", false);
        capabilities.put("packagePrintJob", false);
        capabilities.put("fileTransfer", false);
        capabilities.put("startPrint", false);
        JSObject result = new JSObject();
        result.put("native", true);
        result.put("platform", "android");
        result.put("bridgeVersion", "0.2.0");
        result.put("capabilities", capabilities);
        call.resolve(result);
    }

    @PluginMethod
    public void discoverPrinters(PluginCall call) {
        queue.execute(() -> {
            JSArray printers = new JSArray();
            try {
                List<JSObject> found = Collections.synchronizedList(new ArrayList<>());
                ExecutorService scanner = Executors.newFixedThreadPool(32);
                for (String address : localSubnetCandidates()) scanner.execute(() -> {
                    if (!portOpen(address, 8883, 240)) return;
                    JSObject printer = new JSObject();
                    printer.put("id", address);
                    printer.put("name", "Bambu LAN " + address);
                    printer.put("ip", address);
                    found.add(printer);
                });
                scanner.shutdown();
                scanner.awaitTermination(4, TimeUnit.SECONDS);
                scanner.shutdownNow();
                for (JSObject printer : found) printers.put(printer);
                JSObject result = new JSObject();
                result.put("printers", printers);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not scan the current Wi-Fi network.", error);
            }
        });
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String ip = call.getString("ip");
        String serial = call.getString("serial");
        String trustedFingerprint = call.getString("trustedFingerprint");
        if (ip == null || serial == null) { call.reject("Printer IP and serial are required."); return; }
        queue.execute(() -> {
            try {
                X509Certificate certificate = inspectCertificate(ip, 8883);
                String fingerprint = hex(MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded()));
                if (trustedFingerprint == null || trustedFingerprint.isEmpty()) {
                    JSObject result = new JSObject();
                    result.put("connected", false);
                    result.put("state", "offline");
                    result.put("requiresTrust", true);
                    result.put("certificateFingerprint", fingerprint);
                    call.resolve(result);
                    return;
                }
                if (!fingerprint.equalsIgnoreCase(trustedFingerprint.replace(":", ""))) {
                    call.reject("The printer certificate changed. Connection was blocked.");
                    return;
                }
                JSObject printer = new JSObject();
                printer.put("id", serial);
                printer.put("name", "Bambu " + serial);
                printer.put("ip", ip);
                printer.put("serial", serial);
                connectedPrinter = printer;
                JSObject result = new JSObject();
                result.put("connected", true);
                result.put("state", "idle");
                result.put("printer", printer);
                result.put("certificateFingerprint", fingerprint);
                result.put("transportVerified", true);
                call.resolve(result);
            } catch (Exception error) {
                connectedPrinter = null;
                call.reject("The printer did not complete a TLS handshake on port 8883.", error);
            }
        });
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        connectedPrinter = null;
        JSObject result = new JSObject();
        result.put("connected", false);
        call.resolve(result);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("connected", connectedPrinter != null);
        result.put("state", connectedPrinter == null ? "offline" : "idle");
        if (connectedPrinter != null) result.put("printer", connectedPrinter);
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

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format("%02x", value));
        return result.toString();
    }

    private static X509Certificate inspectCertificate(String host, int port) throws Exception {
        TrustManager[] trust = new TrustManager[]{new X509TrustManager() {
            public void checkClientTrusted(X509Certificate[] chain, String authType) {}
            public void checkServerTrusted(X509Certificate[] chain, String authType) {}
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
        }};
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, trust, new SecureRandom());
        try (SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket()) {
            socket.connect(new InetSocketAddress(host, port), 3500);
            socket.setSoTimeout(3500);
            socket.startHandshake();
            return (X509Certificate) socket.getSession().getPeerCertificates()[0];
        }
    }

    private static boolean portOpen(String host, int port, int timeout) {
        try (Socket socket = new Socket()) {
            socket.connect(new InetSocketAddress(host, port), timeout);
            return true;
        } catch (Exception ignored) { return false; }
    }

    private static List<String> localSubnetCandidates() throws Exception {
        List<String> result = new ArrayList<>();
        for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
            if (!network.isUp() || network.isLoopback()) continue;
            for (InetAddress address : Collections.list(network.getInetAddresses())) {
                if (!(address instanceof Inet4Address) || !address.isSiteLocalAddress()) continue;
                byte[] own = address.getAddress();
                for (int host = 1; host < 255; host++) {
                    if ((own[3] & 255) == host) continue;
                    result.add((own[0] & 255) + "." + (own[1] & 255) + "." + (own[2] & 255) + "." + host);
                }
                return result;
            }
        }
        return result;
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteRecursively(child);
        file.delete();
    }
}
