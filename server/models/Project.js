import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Project name is required"],
      trim: true,
      maxlength: [120, "Project name cannot exceed 120 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [500, "Description cannot exceed 500 characters"],
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Project owner (userId) is required"],
      index: true,
    },
    isArchived: {
      type: Boolean,
      default: false,
      index: true,
    },
    metadata: {
      clientName: { type: String, trim: true, default: "" },
      shootDate: { type: Date, default: null },
      location: { type: String, trim: true, default: "" },
    },
  },
  { timestamps: true }
);

projectSchema.index({ userId: 1, createdAt: -1 });
projectSchema.index({ userId: 1, isArchived: 1 });

export default mongoose.model("Project", projectSchema);
