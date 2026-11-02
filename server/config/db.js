import mongoose from "mongoose";

export async function connectDB() {
  const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/pixsort";
  try {
    await mongoose.connect(uri);
    console.log(`[MongoDB] Connected successfully to ${uri.replace(/\/\/.*@/, "//***:***@")}`);
  } catch (error) {
    console.error("[MongoDB] Connection error:", error.message);
    throw error;
  }
}
