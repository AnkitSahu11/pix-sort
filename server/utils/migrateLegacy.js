import "dotenv/config";
import mongoose from "mongoose";
import Photo from "../models/Photo.js";
import User from "../models/User.js";
import Project from "../models/Project.js";

async function runMigration() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/pixsort";
  await mongoose.connect(uri);
  console.log("[Migration] Connected to MongoDB");

  const args = process.argv.slice(2);
  const targetEmailArg = args.find((a) => a.startsWith("--targetUser="));
  const targetEmail = targetEmailArg ? targetEmailArg.split("=")[1].trim() : null;

  const legacyPhotos = await Photo.find({
    $or: [{ userId: null }, { userId: { $exists: false } }],
  });

  console.log(`[Migration] Found ${legacyPhotos.length} legacy photo(s) without a valid owner.`);

  if (legacyPhotos.length === 0) {
    console.log("[Migration] All photos have verified owners. No action required.");
    await mongoose.disconnect();
    return;
  }

  if (!targetEmail) {
    console.log(
      "[Migration: Safe Quarantine] Legacy photos are currently quarantined and safely hidden from standard users."
    );
    console.log(
      "[Migration: Notice] To assign these photos to a verified user, run:\n  node server/utils/migrateLegacy.js --targetUser=user@example.com"
    );
    await mongoose.disconnect();
    return;
  }

  const targetUser = await User.findOne({ email: targetEmail.toLowerCase() });
  if (!targetUser) {
    console.error(`[Migration Error] Target user '${targetEmail}' was not found.`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Create an explicit legacy recovery project for clarity
  let legacyProject = await Project.findOne({
    userId: targetUser._id,
    name: "Migrated Legacy Shoot",
  });

  if (!legacyProject) {
    legacyProject = await Project.create({
      name: "Migrated Legacy Shoot",
      description: `Recovered legacy photos migrated on ${new Date().toLocaleDateString()}`,
      userId: targetUser._id,
    });
  }

  const result = await Photo.updateMany(
    { $or: [{ userId: null }, { userId: { $exists: false } }] },
    { $set: { userId: targetUser._id, projectId: legacyProject._id } }
  );

  console.log(
    `[Migration Success] Assigned ${result.modifiedCount} photo(s) to user '${targetUser.email}' in project '${legacyProject.name}'.`
  );
  await mongoose.disconnect();
}

if (process.argv[1] && process.argv[1].endsWith("migrateLegacy.js")) {
  runMigration().catch((err) => {
    console.error("[Migration Error]", err);
    process.exit(1);
  });
}

export { runMigration };
