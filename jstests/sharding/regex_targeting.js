// This checks to make sure that sharded regex queries behave the same as unsharded regex queries
(function() {
'use strict';

load("jstests/sharding/updateOne_without_shard_key/libs/write_without_shard_key_test_util.js");

var st = new ShardingTest({shards: 2});

var mongos = st.s0;
var admin = mongos.getDB("admin");

//
// Set up multiple collections to target with regex shard keys on two shards
//

var coll = mongos.getCollection("foo.bar");
var collSharded = mongos.getCollection("foo.barSharded");
var collCompound = mongos.getCollection("foo.barCompound");
var collNested = mongos.getCollection("foo.barNested");
var collHashed = mongos.getCollection("foo.barHashed");

assert.commandWorked(admin.runCommand({enableSharding: coll.getDB().toString()}));
st.ensurePrimaryShard(coll.getDB().toString(), st.shard0.shardName);

//
// Split the collection so that "abcde-0" and "abcde-1" go on different shards when possible
//

assert.commandWorked(admin.runCommand({shardCollection: collSharded.toString(), key: {a: 1}}));
assert.commandWorked(admin.runCommand({split: collSharded.toString(), middle: {a: "abcde-1"}}));
assert.commandWorked(admin.runCommand({
    moveChunk: collSharded.toString(),
    find: {a: 0},
    to: st.shard1.shardName,
    _waitForDelete: true
}));

assert.commandWorked(
    admin.runCommand({shardCollection: collCompound.toString(), key: {a: 1, b: 1}}));
assert.commandWorked(
    admin.runCommand({split: collCompound.toString(), middle: {a: "abcde-1", b: 0}}));
assert.commandWorked(admin.runCommand({
    moveChunk: collCompound.toString(),
    find: {a: 0, b: 0},
    to: st.shard1.shardName,
    _waitForDelete: true
}));

assert.commandWorked(admin.runCommand({shardCollection: collNested.toString(), key: {'a.b': 1}}));
assert.commandWorked(admin.runCommand({split: collNested.toString(), middle: {'a.b': "abcde-1"}}));
assert.commandWorked(admin.runCommand({
    moveChunk: collNested.toString(),
    find: {a: {b: 0}},
    to: st.shard1.shardName,
    _waitForDelete: true
}));

assert.commandWorked(
    admin.runCommand({shardCollection: collHashed.toString(), key: {hash: "hashed"}}));

st.printShardingStatus();

//
//
// Cannot insert regex _id
assert.writeError(coll.insert({_id: /regex value/}));
assert.writeError(collSharded.insert({_id: /regex value/, a: 0}));
assert.writeError(collCompound.insert({_id: /regex value/, a: 0, b: 0}));
assert.writeError(collNested.insert({_id: /regex value/, a: {b: 0}}));
assert.writeError(collHashed.insert({_id: /regex value/, hash: 0}));

//
//
// (For now) we can insert a regex shard key
assert.commandWorked(collSharded.insert({a: /regex value/}));
assert.commandWorked(collCompound.insert({a: /regex value/, b: "other value"}));
assert.commandWorked(collNested.insert({a: {b: /regex value/}}));
assert.commandWorked(collHashed.insert({hash: /regex value/}));

//
//
// Query by regex should hit all matching keys, across all shards if applicable
coll.remove({});
assert.commandWorked(coll.insert({a: "abcde-0"}));
assert.commandWorked(coll.insert({a: "abcde-1"}));
assert.commandWorked(coll.insert({a: /abcde.*/}));
assert.eq(coll.find().itcount(), coll.find({a: /abcde.*/}).itcount());

collSharded.remove({});
assert.commandWorked(collSharded.insert({a: "abcde-0"}));
assert.commandWorked(collSharded.insert({a: "abcde-1"}));
assert.commandWorked(collSharded.insert({a: /abcde.*/}));
assert.eq(collSharded.find().itcount(), collSharded.find({a: /abcde.*/}).itcount());

collCompound.remove({});
assert.commandWorked(collCompound.insert({a: "abcde-0", b: 0}));
assert.commandWorked(collCompound.insert({a: "abcde-1", b: 0}));
assert.commandWorked(collCompound.insert({a: /abcde.*/, b: 0}));
assert.eq(collCompound.find().itcount(), collCompound.find({a: /abcde.*/}).itcount());

collNested.remove({});
assert.commandWorked(collNested.insert({a: {b: "abcde-0"}}));
assert.commandWorked(collNested.insert({a: {b: "abcde-1"}}));
assert.commandWorked(collNested.insert({a: {b: /abcde.*/}}));
assert.eq(collNested.find().itcount(), collNested.find({'a.b': /abcde.*/}).itcount());

collHashed.remove({});
while (st.shard0.getCollection(collHashed.toString()).count() == 0 ||
       st.shard1.getCollection(collHashed.toString()).count() == 0) {
    assert.commandWorked(collHashed.insert({hash: "abcde-" + ObjectId().toString()}));
}
assert.commandWorked(collHashed.insert({hash: /abcde.*/}));
assert.eq(collHashed.find().itcount(), collHashed.find({hash: /abcde.*/}).itcount());

//
//
// Update by regex should hit all matching keys, across all shards if applicable
coll.remove({});
assert.commandWorked(coll.insert({a: "abcde-0"}));
assert.commandWorked(coll.insert({a: "abcde-1"}));
assert.commandWorked(coll.insert({a: /abcde.*/}));
assert.commandWorked(coll.update({a: /abcde.*/}, {$set: {updated: true}}, {multi: true}));
assert.eq(coll.find().itcount(), coll.find({updated: true}).itcount());

collSharded.remove({});
assert.commandWorked(collSharded.insert({a: "abcde-0"}));
assert.commandWorked(collSharded.insert({a: "abcde-1"}));
assert.commandWorked(collSharded.insert({a: /abcde.*/}));
assert.commandWorked(collSharded.update({a: /abcde.*/}, {$set: {updated: true}}, {multi: true}));
assert.eq(collSharded.find().itcount(), collSharded.find({updated: true}).itcount());

collCompound.remove({});
assert.commandWorked(collCompound.insert({a: "abcde-0", b: 0}));
assert.commandWorked(collCompound.insert({a: "abcde-1", b: 0}));
assert.commandWorked(collCompound.insert({a: /abcde.*/, b: 0}));
assert.commandWorked(collCompound.update({a: /abcde.*/}, {$set: {updated: true}}, {multi: true}));
assert.eq(collCompound.find().itcount(), collCompound.find({updated: true}).itcount());

collNested.remove({});
assert.commandWorked(collNested.insert({a: {b: "abcde-0"}}));
assert.commandWorked(collNested.insert({a: {b: "abcde-1"}}));
assert.commandWorked(collNested.insert({a: {b: /abcde.*/}}));
assert.commandWorked(collNested.update({'a.b': /abcde.*/}, {$set: {updated: true}}, {multi: true}));
assert.eq(collNested.find().itcount(), collNested.find({updated: true}).itcount());

collHashed.remove({});
while (st.shard0.getCollection(collHashed.toString()).count() == 0 ||
       st.shard1.getCollection(collHashed.toString()).count() == 0) {
    assert.commandWorked(collHashed.insert({hash: "abcde-" + ObjectId().toString()}));
}
assert.commandWorked(collHashed.insert({hash: /abcde.*/}));
assert.commandWorked(collHashed.update({hash: /abcde.*/}, {$set: {updated: true}}, {multi: true}));
assert.eq(collHashed.find().itcount(), collHashed.find({updated: true}).itcount());

collSharded.remove({});
collCompound.remove({});
collNested.remove({});

// Sharded updateOnes that do not directly target a shard can now use the two phase write
// protocol to execute.
if (WriteWithoutShardKeyTestUtil.isWriteWithoutShardKeyFeatureEnabled(st.s)) {
    assert.commandWorked(collSharded.update({a: /abcde-1/}, {"$set": {b: 1}}, {upsert: false}));
    assert.commandWorked(collSharded.update({a: /abcde-[1-2]/}, {"$set": {b: 1}}, {upsert: false}));
    assert.commandWorked(collNested.update(
        {a: {b: /abcde-1/}}, {"$set": {"a.b": /abcde-1/, b: 1}}, {upsert: false}));
    assert.commandWorked(collNested.update({"a.b": /abcde.*/}, {"$set": {b: 1}}, {upsert: false}));
} else {
    //
    //
    // Op-style updates with regex should fail on sharded collections.
    // Query clause is targeted, and regex in query clause is ambiguous.
    assert.commandFailedWithCode(
        collSharded.update({a: /abcde-1/}, {"$set": {b: 1}}, {upsert: false}),
        ErrorCodes.InvalidOptions);
    assert.commandFailedWithCode(
        collSharded.update({a: /abcde-[1-2]/}, {"$set": {b: 1}}, {upsert: false}),
        ErrorCodes.InvalidOptions);
    assert.commandFailedWithCode(
        collNested.update({a: {b: /abcde-1/}}, {"$set": {"a.b": /abcde-1/, b: 1}}, {upsert: false}),
        ErrorCodes.InvalidOptions);
    assert.commandFailedWithCode(
        collNested.update({"a.b": /abcde.*/}, {"$set": {b: 1}}, {upsert: false}),
        ErrorCodes.InvalidOptions);
}

//
//
// Replacement style updates with regex should work on sharded collections.
// If query clause is ambiguous, we fallback to using update clause for targeting.
assert.commandWorked(collSharded.update({a: /abcde.*/}, {a: /abcde.*/, b: 1}, {upsert: false}));
assert.commandWorked(collSharded.update({a: /abcde-1/}, {a: /abcde-1/, b: 1}, {upsert: false}));
assert.commandWorked(collNested.update({a: {b: /abcde.*/}}, {a: {b: /abcde.*/}}, {upsert: false}));
assert.commandWorked(collNested.update({'a.b': /abcde-1/}, {a: {b: /abcde.*/}}, {upsert: false}));

// Sharded updateOnes that do not directly target a shard can now use the two phase write
// protocol to execute.
if (WriteWithoutShardKeyTestUtil.isWriteWithoutShardKeyFeatureEnabled(st.s)) {
    // TODO: SERVER-69918 Implement upsert behavior for _clusterQueryWithoutShardKey
} else {
    //
    //
    // Upsert with op-style regex should fail on sharded collections
    // Query clause is targeted, and regex in query clause is ambiguous

    // The queries will also be interpreted as regex based prefix search and cannot target a single
    // shard.
    assert.writeError(collSharded.update({a: /abcde.*/}, {$set: {a: /abcde.*/}}, {upsert: true}));
    assert.writeError(
        collCompound.update({a: /abcde-1/}, {$set: {a: /abcde.*/, b: 1}}, {upsert: true}));
    // Exact regex in query never equality
    assert.writeError(
        collNested.update({'a.b': /abcde.*/}, {$set: {'a.b': /abcde.*/}}, {upsert: true}));
    // Even nested regexes are not extracted in queries
    assert.writeError(
        collNested.update({a: {b: /abcde.*/}}, {$set: {'a.b': /abcde.*/}}, {upsert: true}));
    assert.writeError(collNested.update({c: 1}, {$set: {'a.b': /abcde.*/}}, {upsert: true}));

    //
    //
    // Upsert by replacement-style regex should fail on sharded collections
    // Query clause is targeted, and regex in query clause is ambiguous
    assert.commandFailedWithCode(collSharded.update({a: /abcde.*/}, {a: /abcde.*/}, {upsert: true}),
                                 ErrorCodes.ShardKeyNotFound);
    assert.commandFailedWithCode(
        collCompound.update({a: /abcde.*/}, {a: /abcde.*/, b: 1}, {upsert: true}),
        ErrorCodes.ShardKeyNotFound);
    assert.commandFailedWithCode(
        collNested.update({'a.b': /abcde-1/}, {a: {b: /abcde.*/}}, {upsert: true}),
        ErrorCodes.ShardKeyNotFound);
    assert.commandFailedWithCode(
        collNested.update({a: {b: /abcde.*/}}, {a: {b: /abcde.*/}}, {upsert: true}),
        ErrorCodes.ShardKeyNotFound);
    assert.commandFailedWithCode(collNested.update({c: 1}, {a: {b: /abcde.*/}}, {upsert: true}),
                                 ErrorCodes.ShardKeyNotFound);
}

//
//
// Remove by regex should hit all matching keys, across all shards if applicable
coll.remove({});
assert.commandWorked(coll.insert({a: "abcde-0"}));
assert.commandWorked(coll.insert({a: "abcde-1"}));
assert.commandWorked(coll.insert({a: /abcde.*/}));
assert.commandWorked(coll.remove({a: /abcde.*/}));
assert.eq(0, coll.find({}).itcount());

collSharded.remove({});
assert.commandWorked(collSharded.insert({a: "abcde-0"}));
assert.commandWorked(collSharded.insert({a: "abcde-1"}));
assert.commandWorked(collSharded.insert({a: /abcde.*/}));
assert.commandWorked(collSharded.remove({a: /abcde.*/}));
assert.eq(0, collSharded.find({}).itcount());

collCompound.remove({});
assert.commandWorked(collCompound.insert({a: "abcde-0", b: 0}));
assert.commandWorked(collCompound.insert({a: "abcde-1", b: 0}));
assert.commandWorked(collCompound.insert({a: /abcde.*/, b: 0}));
assert.commandWorked(collCompound.remove({a: /abcde.*/}));
assert.eq(0, collCompound.find({}).itcount());

collNested.remove({});
assert.commandWorked(collNested.insert({a: {b: "abcde-0"}}));
assert.commandWorked(collNested.insert({a: {b: "abcde-1"}}));
assert.commandWorked(collNested.insert({a: {b: /abcde.*/}}));
assert.commandWorked(collNested.remove({'a.b': /abcde.*/}));
assert.eq(0, collNested.find({}).itcount());

collHashed.remove({});
while (st.shard0.getCollection(collHashed.toString()).count() == 0 ||
       st.shard1.getCollection(collHashed.toString()).count() == 0) {
    assert.commandWorked(collHashed.insert({hash: "abcde-" + ObjectId().toString()}));
}
assert.commandWorked(collHashed.insert({hash: /abcde.*/}));
assert.commandWorked(collHashed.remove({hash: /abcde.*/}));
assert.eq(0, collHashed.find({}).itcount());

//
//
// Query/Update/Remove by nested regex is different depending on how the nested regex is
// specified
coll.remove({});
assert.commandWorked(coll.insert({a: {b: "abcde-0"}}));
assert.commandWorked(coll.insert({a: {b: "abcde-1"}}));
assert.commandWorked(coll.insert({a: {b: /abcde.*/}}));
assert.eq(1, coll.find({a: {b: /abcde.*/}}).itcount());
assert.commandWorked(coll.update({a: {b: /abcde.*/}}, {$set: {updated: true}}, {multi: true}));
assert.eq(1, coll.find({updated: true}).itcount());
assert.commandWorked(coll.remove({a: {b: /abcde.*/}}));
assert.eq(2, coll.find().itcount());

collNested.remove({});
assert.commandWorked(collNested.insert({a: {b: "abcde-0"}}));
assert.commandWorked(collNested.insert({a: {b: "abcde-1"}}));
assert.commandWorked(collNested.insert({a: {b: /abcde.*/}}));
assert.eq(1, collNested.find({a: {b: /abcde.*/}}).itcount());
assert.commandWorked(
    collNested.update({a: {b: /abcde.*/}}, {$set: {updated: true}}, {multi: true}));
assert.eq(1, collNested.find({updated: true}).itcount());
assert.commandWorked(collNested.remove({a: {b: /abcde.*/}}));
assert.eq(2, collNested.find().itcount());

st.stop();
})();
