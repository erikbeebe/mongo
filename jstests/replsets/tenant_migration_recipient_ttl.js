/**
 * Tests to check whether the TTL index is being created and is functioning correctly on the tenant
 * migration recipient.
 *
 * @tags: [
 *   incompatible_with_macos,
 *   incompatible_with_windows_tls,
 *   requires_persistence,
 *   serverless,
 * ]
 */

import {TenantMigrationTest} from "jstests/replsets/libs/tenant_migration_test.js";
load("jstests/libs/uuid_util.js");  // For extractUUIDFromObject().

const kGarbageCollectionParams = {
    // Set the delay to 20s so that we can see the `expireAt` set prior to the document vanishing.
    tenantMigrationGarbageCollectionDelayMS: 20 * 1000,

    // Set the TTL monitor to run at a smaller interval to speed up the test.
    ttlMonitorSleepSecs: 1
};

const tenantMigrationTest = new TenantMigrationTest({
    name: jsTestName(),
    sharedOptions: {setParameter: kGarbageCollectionParams},
});

const kRecipientTTLIndexName = "TenantMigrationRecipientTTLIndex";

const kMigrationId = UUID();
const kTenantId = ObjectId().str;

const migrationOpts = {
    migrationIdString: extractUUIDFromObject(kMigrationId),
    tenantId: kTenantId,
    readPreference: {mode: "primary"}
};

const recipientPrimary = tenantMigrationTest.getRecipientPrimary();
const configDB = recipientPrimary.getDB("config");
const tenantMigrationRecipientStateColl = configDB["tenantMigrationRecipients"];

jsTestLog("Ensure the TTL index was created.");
const indexes = tenantMigrationRecipientStateColl.getIndexes();
let i = 0;
for (; i < indexes.length; i++) {
    if (indexes[i].name == kRecipientTTLIndexName) {
        assert.eq(indexes[i].key.expireAt, 1, tojson(indexes));
        assert.eq(indexes[i].expireAfterSeconds, 0, tojson(indexes));
        break;
    }
}
// A TTL index must be found on the primary.
assert.neq(i, indexes.length, tojson(indexes));

jsTestLog("Starting and completing a tenant migration with migrationId: " + kMigrationId +
          ", tenantId: " + kTenantId);
assert.commandWorked(tenantMigrationTest.startMigration(migrationOpts));
TenantMigrationTest.assertCommitted(tenantMigrationTest.waitForMigrationToComplete(migrationOpts));

// The migration's document will not be marked as garbage collectable until forgetMigration. The
// document should exist in the collection now, without an expireAt field.
jsTestLog("Making sure migration state document exists.");
let stateDocQuery = tenantMigrationRecipientStateColl.find({_id: kMigrationId}).toArray();
assert.eq(stateDocQuery.length, 1, tojson(stateDocQuery));
assert(!stateDocQuery[0].hasOwnProperty("expireAt"), tojson(stateDocQuery));

jsTestLog("Forgetting the migration.");
assert.commandWorked(tenantMigrationTest.forgetMigration(migrationOpts.migrationIdString));

// The state document should now have the expireAt field.
jsTestLog("Expect to find expireAt field.");
stateDocQuery = tenantMigrationRecipientStateColl.find({_id: kMigrationId}).toArray();
assert.eq(stateDocQuery.length, 1, tojson(stateDocQuery));
assert(stateDocQuery[0].hasOwnProperty("expireAt"), tojson(stateDocQuery));

// Sleep past the garbage collection delay time, and then make sure the state document for our
// migration does not exist.
jsTestLog("Waiting for the state document to have been deleted.");
tenantMigrationTest.waitForMigrationGarbageCollection(kMigrationId, kTenantId);

tenantMigrationTest.stop();
