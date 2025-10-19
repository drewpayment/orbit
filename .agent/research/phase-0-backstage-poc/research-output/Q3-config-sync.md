# Q3: Configuration Sync Mechanism

## Date: 2025-10-19

## Test Results: Config Hot-Reload

### Test Performed

1. Started Backstage backend
2. Modified `app-config.yaml` (added comment)
3. Waited 5 minutes
4. Checked backend logs for reload indication

### Result: ❌ NO HOT-RELOAD

**Finding:** Backstage does NOT automatically reload configuration when files change.

**Evidence:**
```
Loading config from MergedConfigSource{...}  ← Only at startup
[No subsequent config reload messages after file modification]
```

**Conclusion:** Configuration changes require **backend restart**.

## Current Config Loading Mechanism

### Startup Behavior

```
MergedConfigSource{
  FileConfigSource{path="app-config.yaml"},
  FileConfigSource{path="app-config.local.yaml"},
  EnvConfigSource{count=0}
}
```

Backstage loads config from:
1. `app-config.yaml` (base config)
2. `app-config.local.yaml` (local overrides, git ignored)
3. Environment variables

### Config Merge Order

```
app-config.yaml
  ↓ (overridden by)
app-config.local.yaml
  ↓ (overridden by)
Environment Variables
```

Later sources override earlier ones.

## Implications for Orbit

### Challenge: Admin UI Changes Need Backend Restart

**Problem Flow:**
```
1. Admin updates plugin config in Payload CMS
2. Payload saves to database
3. Backstage still has old config (in memory)
4. **Backstage must restart to see new config** ← Problem!
```

**Impact:**
- Downtime during config updates
- Slow iteration (restart takes ~30s)
- Poor admin UX

## Recommended Solutions

### Option 1: Dynamic Config Provider (Custom Backstage Module)

**Concept:** Create custom Backstage module that polls Orbit API for config updates.

**Implementation:**
```typescript
// services/backstage-backend/src/modules/orbit-config/index.ts
import { createBackendModule } from '@backstage/backend-plugin-api';
import { ConfigReader } from '@backstage/config';

export const orbitConfigModule = createBackendModule({
  pluginId: 'app',
  moduleId: 'orbit-config',
  register(env) {
    env.registerInit({
      deps: { config: coreServices.rootConfig, logger: coreServices.logger },
      async init({ config, logger }) {
        const orbitApiUrl = config.getString('orbit.apiUrl');
        const pollInterval = 60000; // 60 seconds

        // Poll Orbit API for config updates
        setInterval(async () => {
          try {
            const response = await fetch(`${orbitApiUrl}/api/plugins/config`);
            const newConfig = await response.json();

            // WARNING: Backstage config is mostly immutable after startup
            // Only certain plugins support dynamic config updates
            // Most plugins read config once at initialization

            logger.info('Attempted config refresh from Orbit API');
          } catch (error) {
            logger.error('Failed to fetch plugin config', error);
          }
        }, pollInterval);
      },
    });
  },
});
```

**Limitations:**
- ⚠️ Most Backstage plugins read config ONCE at initialization
- ⚠️ Changing config doesn't affect already-initialized plugins
- ⚠️ Would need plugin-specific reload mechanisms

**Conclusion:** ❌ Not practical for most plugins

### Option 2: Automated Restart on Config Change

**Concept:** Detect config changes and gracefully restart Backstage.

**Implementation:**
```go
// services/plugins/internal/lifecycle/config_watcher.go
func (m *InstanceManager) WatchConfig(workspaceID string) {
  ticker := time.NewTicker(30 * time.Second)

  for range ticker.C {
    newConfig := m.fetchConfigFromOrbit(workspaceID)
    currentConfig := m.getCurrentConfig(workspaceID)

    if !reflect.DeepEqual(newConfig, currentConfig) {
      log.Info("Config changed, restarting Backstage instance")

      // 1. Write new config file
      m.writeConfigFile(workspaceID, newConfig)

      // 2. Graceful restart
      m.restartInstance(workspaceID)  // ~30s downtime
    }
  }
}
```

**Pros:**
- ✅ Works with all plugins (no custom code needed)
- ✅ Guaranteed config consistency
- ✅ Simple implementation

**Cons:**
- ⚠️ ~30 second downtime per restart
- ⚠️ Ongoing requests interrupted

**Verdict:** ✅ ACCEPTABLE for Phase 1

### Option 3: Blue-Green Deployment for Zero-Downtime

**Concept:** Start new instance with new config, switch traffic after ready.

**Flow:**
```
1. Config changes detected
2. Start NEW Backstage instance (port 7008) with new config
3. Wait for initialization (~30s)
4. Switch Orbit proxy to route to new instance
5. Gracefully shutdown old instance
6. Rename new instance to take over port 7007
```

**Pros:**
- ✅ Zero downtime for users
- ✅ Works with all plugins
- ✅ Can rollback if new config fails

**Cons:**
- ⚠️ More complex implementation
- ⚠️ Requires 2x resources during transition

**Verdict:** ✅ IDEAL for Production (Phase 2+)

## Recommended Approach for Orbit

### Phase 1: Simple Restart (Option 2)

**Why:**
- Simplest implementation
- ~30s downtime acceptable for PoC
- Works reliably

**Implementation:**
```yaml
# Orbit API detects config change
POST /api/plugins/config
  → Returns updated config

# Go plugins service checks for changes every 30s
if configChanged {
  writeConfigFile()
  restartBackstageInstance() // docker restart backstage-ws-123
}
```

### Phase 2+: Blue-Green Zero-Downtime (Option 3)

**Why:**
- Production-grade UX
- No downtime for users
- Safe rollback

## Config Change Latency

### With Simple Restart (Option 2)

```
Admin saves config in Payload
  ↓ (instant)
Orbit database updated
  ↓ (30s polling interval)
Go service detects change
  ↓ (instant)
Write new config file
  ↓ (instant)
Restart Backstage
  ↓ (30s restart time)
New config active
```

**Total Latency:** ~60 seconds (30s poll + 30s restart)

**Downtime:** ~30 seconds

### With Blue-Green (Option 3)

**Total Latency:** ~60 seconds (30s poll + 30s new instance startup)

**Downtime:** 0 seconds ✅

## Alternative: Pre-Defined Config Templates

**Concept:** Instead of dynamic config, use predefined templates.

**Example:**
```typescript
// Payload CMS stores config VALUES, not structure
{
  pluginId: "argocd",
  workspace: "ws-123",
  config: {
    instanceUrl: "https://argocd.acme.com",
    token: "encrypted-token-here"
  }
}

// Go service uses template to generate app-config.yaml
argocd:
  appLocatorMethods:
    - type: 'config'
      instances:
        - name: '{{ workspace.name }}'
          url: '{{ config.instanceUrl }}'
          token: '{{ config.token }}'
```

**Pros:**
- ✅ Structured config schema
- ✅ Validation in Payload UI
- ✅ Type-safe

**Cons:**
- ⚠️ Less flexible
- ⚠️ Can't handle arbitrary config

**Verdict:** ✅ USE THIS + Restart mechanism

## Conclusion

### Key Findings

1. ❌ Backstage does NOT support hot config reload
2. ✅ Restarts are required for config changes
3. ✅ Simple restart acceptable for Phase 1
4. ✅ Blue-green deployment for production

### Recommended Implementation

**Phase 1:**
```
Payload CMS
  ↓
Orbit API (config endpoint)
  ↓ (polling every 30s)
Go Plugins Service (detect changes)
  ↓
Restart Backstage Instance
  ↓ (~30s downtime)
New Config Active
```

**Phase 2+:**
```
Payload CMS
  ↓
Orbit API
  ↓
Go Plugins Service
  ↓
Blue-Green Instance Swap
  ↓ (zero downtime)
New Config Active
```

**Confidence Level:** HIGH - Tested and confirmed no hot-reload support.
