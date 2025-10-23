# Phase 3 Testing Guide

**Date**: 2025-10-19
**Status**: ✅ Ready for Manual Testing
**Payload URL**: http://localhost:3000/admin

## What's Been Completed

### ✅ Setup Complete
1. **Payload CMS Running**: Server started on port 3000
2. **Collections Registered**: PluginRegistry and PluginConfig added to Payload
3. **Seed Data Loaded**: 3 plugins successfully created:
   - Software Catalog (catalog)
   - GitHub Actions (github-actions)
   - ArgoCD (argocd)

### ✅ What to Test Now

## Test 1: View Plugin Registry Collection

**Steps**:
1. Open browser to: http://localhost:3000/admin
2. Log in (if you have an account, or create one)
3. In the sidebar, look for **"Platform"** section
4. Click on **"Plugin Registry"**

**Expected Result**:
- You should see 3 plugins listed:
  - Software Catalog
  - GitHub Actions
  - ArgoCD
- Each should have:
  - Plugin ID
  - Category (api-catalog, ci-cd, infrastructure)
  - Version number
  - Enabled status (checked)

**What to Verify**:
- ✅ All 3 plugins appear
- ✅ Plugin metadata is complete
- ✅ Icons/images if uploaded
- ✅ "Platform" group shows in sidebar

## Test 2: View Plugin Details

**Steps**:
1. Click on "Software Catalog" plugin
2. Review all fields

**Expected Result**:
You should see:
- **Basic Info**:
  - Plugin ID: `catalog`
  - Name: `Software Catalog`
  - Description: Full description
  - Category: `API Catalog`
  - Enabled: Yes

- **Plugin Metadata**:
  - Version: `1.24.0`
  - Backstage Package: `@backstage/plugin-catalog`
  - API Base Path: `/api/catalog`
  - Documentation URL: https://backstage.io/...

- **Configuration Schema**:
  - Optional Config Keys (array with items)
  - Supported Features (5 features listed)

- **Requirements**:
  - Minimum Backstage Version: `1.10.0`

- **Plugin Status**:
  - Stability: `stable`
  - Last Tested: 2025-10-19

## Test 3: View GitHub Actions Plugin

**Steps**:
1. Go back to Plugin Registry list
2. Click on "GitHub Actions"

**Expected Result**:
- Should see similar structure
- **Key difference**: Required Config Keys should list:
  - `github.token` (type: secret, isSecret: true)

**What to Verify**:
- ✅ Required configuration defined
- ✅ External dependencies listed (GitHub)
- ✅ Supported features (4 features)

## Test 4: View ArgoCD Plugin

**Steps**:
1. Go back to Plugin Registry list
2. Click on "ArgoCD"

**Expected Result**:
- Category: `Infrastructure`
- Required Config:
  - `argocd.baseUrl`
  - `argocd.token` (secret)
- External Dependencies: ArgoCD instance

## Test 5: Access Control (Admin Only)

**Expected Behavior**:
- ✅ You CAN view the plugin registry (read access)
- ✅ If you're an admin, you CAN create/edit/delete plugins
- ❌ If you're NOT an admin, Create/Edit/Delete buttons should be disabled

**To Test**:
1. Try clicking "Create New" button
2. If admin: Form should open
3. If not admin: Button should be disabled or show error

## Test 6: View Plugin Config Collection

**Steps**:
1. In sidebar under "Platform", click **"Plugin Config"**

**Expected Result**:
- Empty list (no configs created yet)
- OR if you have workspaces, you can create configs

**What to Verify**:
- ✅ Collection appears in admin UI
- ✅ Empty state shows correctly
- ✅ "Create New" button available (if you have workspace admin rights)

## Test 7: Create a Plugin Configuration (Manual)

**Prerequisites**:
- You need at least one workspace
- You need to be a workspace admin or owner

**Steps**:
1. Navigate to "Plugin Config"
2. Click "Create New"
3. Select fields:
   - **Workspace**: Choose your workspace
   - **Plugin**: Select "Software Catalog"
   - **Enabled**: Check the box
   - **Configuration**: Add JSON: `{}`
   - Leave secrets empty for now
4. Click "Save"

**Expected Result**:
- ✅ Configuration saved successfully
- ✅ Display Name auto-computed: "Your Workspace - Software Catalog"
- ✅ Enabled By: Your user
- ✅ Enabled At: Current timestamp
- ✅ Status fields default to "unknown"

## Test 8: Test EncryptedField Component

**Steps**:
1. When creating/editing a PluginConfig
2. Add an item to the "Secrets" array
3. Fill in:
   - Key: `test-key`
   - Value: `secret-value-123`
   - Description: `Test secret`

**Expected Result**:
- ✅ Value field shows as password (dots)
- ✅ "Show/Hide" button appears next to value
- ✅ Clicking "Show" reveals the value
- ✅ Clicking "Hide" masks it again
- ✅ Help text shows: "This value will be encrypted when saved"

## Test 9: Test Unique Constraint

**Steps**:
1. Create a plugin config for Workspace A + Catalog plugin
2. Try to create another config for the SAME workspace + plugin

**Expected Result**:
- ❌ Second creation should fail
- Error message about duplicate combination

**Purpose**: Ensures one config per plugin per workspace

## Test 10: Access Control for Plugin Config

**To Test**:
1. Create a plugin config for "Workspace A"
2. Log in as a user who is NOT a member of "Workspace A"
3. Go to Plugin Config collection

**Expected Result**:
- User should NOT see configs for "Workspace A"
- Only sees configs for workspaces they're a member of

**If you're admin**:
- Should see ALL plugin configs regardless of workspace

## Verification Checklist

### Collections
- [ ] PluginRegistry appears in admin UI
- [ ] PluginConfig appears in admin UI
- [ ] Both under "Platform" group
- [ ] 3 plugins seeded successfully

### PluginRegistry Features
- [ ] All fields display correctly
- [ ] Metadata section complete
- [ ] Configuration schema shows
- [ ] Requirements section populated
- [ ] Status fields present
- [ ] Access control enforced (admin only for create/edit/delete)

### PluginConfig Features
- [ ] Workspace relationship works
- [ ] Plugin relationship works
- [ ] Display name auto-computes
- [ ] Enabled toggle works
- [ ] Configuration JSON field works
- [ ] Secrets array works
- [ ] EncryptedField shows/hides value
- [ ] Status fields present
- [ ] Audit trail fields auto-populate
- [ ] Unique constraint enforced
- [ ] Access control enforced (workspace admin only)

## Known Issues / Limitations

### Not Yet Implemented
1. **Secret Encryption**: Values saved as plaintext (encryption TODO)
2. **Health Monitoring**: Status fields exist but no background updates
3. **Configuration Validation**: JSON not validated against schema
4. **Sync to gRPC Service**: afterChange hooks log but don't sync

### Expected Behavior
- ✅ Collections work in admin UI
- ✅ Relationships work
- ✅ Access control enforced
- ✅ Unique constraints enforced
- ✅ Audit trail populated
- ⏳ Encryption pending
- ⏳ Health checks pending
- ⏳ gRPC sync pending

## Next Steps After Verification

### If Everything Works
1. ✅ Phase 3 collections verified
2. Move to Option B or C from Phase 3 summary:
   - Build admin UI components
   - Complete integration layer
   - Production preparation

### If Issues Found
1. Document issues in GitHub issue or notes
2. Fix collections/components as needed
3. Re-test

## Quick Commands Reference

```bash
# Start Payload CMS
cd orbit-www && bun dev

# Reseed plugins (if needed)
bun run src/scripts/seed-plugins.ts

# View running dev server
# Access: http://localhost:3000/admin

# Stop dev server
# Press Ctrl+C in terminal
```

## Success Criteria

**Phase 3 is successful if**:
- ✅ Both collections appear in admin UI
- ✅ Can view all 3 seeded plugins
- ✅ Can create plugin configs (if have workspace access)
- ✅ EncryptedField component works
- ✅ Access control prevents unauthorized actions
- ✅ Unique constraint enforced
- ✅ Audit trail fields populate automatically

---

**Ready to Test!** Open http://localhost:3000/admin and follow the tests above.
