[38;2;131;148;150m   1[0m [38;2;248;248;242mpackage main[0m
[38;2;131;148;150m   2[0m 
[38;2;131;148;150m   3[0m [38;2;248;248;242mimport ([0m
[38;2;131;148;150m   4[0m [38;2;248;248;242m    "context"[0m
[38;2;131;148;150m   5[0m [38;2;248;248;242m    "fmt"[0m
[38;2;131;148;150m   6[0m [38;2;248;248;242m    "log"[0m
[38;2;131;148;150m   7[0m [38;2;248;248;242m    "time"[0m
[38;2;131;148;150m   8[0m 
[38;2;131;148;150m   9[0m [38;2;248;248;242m    pluginsv1 "github.com/drewpayment/orbit/proto/gen/go/idp/plugins/v1"[0m
[38;2;131;148;150m  10[0m [38;2;248;248;242m    "google.golang.org/grpc"[0m
[38;2;131;148;150m  11[0m [38;2;248;248;242m    "google.golang.org/grpc/credentials/insecure"[0m
[38;2;131;148;150m  12[0m [38;2;248;248;242m)[0m
[38;2;131;148;150m  13[0m 
[38;2;131;148;150m  14[0m [38;2;248;248;242mfunc main() {[0m
[38;2;131;148;150m  15[0m [38;2;248;248;242m    // Connect to the gRPC server[0m
[38;2;131;148;150m  16[0m [38;2;248;248;242m    conn, err := grpc.Dial("localhost:50053", grpc.WithTransportCredentials(insecure.NewCredentials()))[0m
[38;2;131;148;150m  17[0m [38;2;248;248;242m    if err != nil {[0m
[38;2;131;148;150m  18[0m [38;2;248;248;242m        log.Fatalf("Failed to connect: %v", err)[0m
[38;2;131;148;150m  19[0m [38;2;248;248;242m    }[0m
[38;2;131;148;150m  20[0m [38;2;248;248;242m    defer conn.Close()[0m
[38;2;131;148;150m  21[0m 
[38;2;131;148;150m  22[0m [38;2;248;248;242m    client := pluginsv1.NewPluginsServiceClient(conn)[0m
[38;2;131;148;150m  23[0m 
[38;2;131;148;150m  24[0m [38;2;248;248;242m    // Test ListPlugins[0m
[38;2;131;148;150m  25[0m [38;2;248;248;242m    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)[0m
[38;2;131;148;150m  26[0m [38;2;248;248;242m    defer cancel()[0m
[38;2;131;148;150m  27[0m 
[38;2;131;148;150m  28[0m [38;2;248;248;242m    resp, err := client.ListPlugins(ctx, &pluginsv1.ListPluginsRequest{[0m
[38;2;131;148;150m  29[0m [38;2;248;248;242m        WorkspaceId: "ws-test",[0m
[38;2;131;148;150m  30[0m [38;2;248;248;242m    })[0m
[38;2;131;148;150m  31[0m [38;2;248;248;242m    if err != nil {[0m
[38;2;131;148;150m  32[0m [38;2;248;248;242m        log.Fatalf("ListPlugins failed: %v", err)[0m
[38;2;131;148;150m  33[0m [38;2;248;248;242m    }[0m
[38;2;131;148;150m  34[0m 
[38;2;131;148;150m  35[0m [38;2;248;248;242m    fmt.Printf("✅ ListPlugins successful!\n")[0m
[38;2;131;148;150m  36[0m [38;2;248;248;242m    fmt.Printf("Found %d plugins:\n", len(resp.Plugins))[0m
[38;2;131;148;150m  37[0m [38;2;248;248;242m    for _, plugin := range resp.Plugins {[0m
[38;2;131;148;150m  38[0m [38;2;248;248;242m        fmt.Printf("  - %s (%s): %s\n", plugin.Name, plugin.Id, plugin.Description)[0m
[38;2;131;148;150m  39[0m [38;2;248;248;242m    }[0m
[38;2;131;148;150m  40[0m [38;2;248;248;242m}[0m
