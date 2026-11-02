import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import Project from "../models/Project.js";
import Photo from "../models/Photo.js";

export async function createProject(req, res, next) {
  try {
    const { name, description, metadata } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Project name is required",
        errorCode: "VALIDATION_ERROR",
      });
    }

    const project = await Project.create({
      name: name.trim(),
      description: typeof description === "string" ? description.trim() : "",
      userId: req.user._id,
      metadata: metadata || {},
    });

    res.status(201).json({
      success: true,
      data: project,
      message: "Project created successfully",
    });
  } catch (e) {
    next(e);
  }
}

export async function listProjects(req, res, next) {
  try {
    const query = { userId: req.user._id };
    if (req.query.archived !== undefined) {
      query.isArchived = req.query.archived === "true";
    }

    const projects = await Project.find(query).sort({ createdAt: -1 }).lean();

    // Attach photo counts per project
    const projectIds = projects.map((p) => p._id);
    const counts = await Photo.aggregate([
      { $match: { userId: req.user._id, projectId: { $in: projectIds } } },
      {
        $group: {
          _id: "$projectId",
          totalPhotos: { $sum: 1 },
          shortlistedCount: {
            $sum: { $cond: [{ $in: ["$status", ["shortlisted", "favorite"]] }, 1, 0] },
          },
        },
      },
    ]);

    const countMap = new Map(counts.map((c) => [String(c._id), c]));

    const enriched = projects.map((p) => {
      const stats = countMap.get(String(p._id)) || { totalPhotos: 0, shortlistedCount: 0 };
      return {
        ...p,
        stats,
      };
    });

    res.json({
      success: true,
      data: enriched,
    });
  } catch (e) {
    next(e);
  }
}

export async function getProject(req, res, next) {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.user._id,
    }).lean();

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
        errorCode: "NOT_FOUND",
      });
    }

    const [totalPhotos, shortlistedCount, flaggedCount] = await Promise.all([
      Photo.countDocuments({ userId: req.user._id, projectId: project._id }),
      Photo.countDocuments({
        userId: req.user._id,
        projectId: project._id,
        status: { $in: ["shortlisted", "favorite"] },
      }),
      Photo.countDocuments({
        userId: req.user._id,
        projectId: project._id,
        $or: [{ flagged: true }, { status: "flagged" }],
      }),
    ]);

    res.json({
      success: true,
      data: {
        ...project,
        stats: { totalPhotos, shortlistedCount, flaggedCount },
      },
    });
  } catch (e) {
    next(e);
  }
}

export async function updateProject(req, res, next) {
  try {
    const { name, description, isArchived, metadata } = req.body;
    const updates = {};

    if (name !== undefined) {
      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          success: false,
          message: "Project name cannot be empty",
          errorCode: "VALIDATION_ERROR",
        });
      }
      updates.name = name.trim();
    }

    if (description !== undefined) updates.description = String(description).trim();
    if (isArchived !== undefined) updates.isArchived = Boolean(isArchived);
    if (metadata !== undefined) updates.metadata = metadata;

    const project = await Project.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { $set: updates },
      { new: true }
    );

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
        errorCode: "NOT_FOUND",
      });
    }

    res.json({
      success: true,
      data: project,
      message: "Project updated successfully",
    });
  } catch (e) {
    next(e);
  }
}

export async function deleteProject(req, res, next) {
  try {
    const project = await Project.findOneAndDelete({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
        errorCode: "NOT_FOUND",
      });
    }

    // Clean up photos and files belonging to this project
    const photos = await Photo.find({ userId: req.user._id, projectId: project._id });
    await Promise.all(
      photos.map(async (p) => {
        if (p.filePath) await fs.unlink(p.filePath).catch(() => {});
        if (p.thumbnailPath) await fs.unlink(p.thumbnailPath).catch(() => {});
      })
    );

    await Photo.deleteMany({ userId: req.user._id, projectId: project._id });

    res.json({
      success: true,
      message: "Project and associated photos deleted successfully",
    });
  } catch (e) {
    next(e);
  }
}

export async function exportProjectZip(req, res, next) {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
        errorCode: "NOT_FOUND",
      });
    }

    const photos = await Photo.find({
      userId: req.user._id,
      projectId: project._id,
      status: { $in: ["shortlisted", "favorite"] },
    }).sort({ frameIndex: 1 });

    if (!photos.length) {
      return res.status(404).json({
        success: false,
        message: "No shortlisted photos to export in this project",
        errorCode: "EMPTY_SHORTLIST",
      });
    }

    const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    res.attachment(`${safeName}-shortlist.zip`);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", next);
    archive.pipe(res);

    const used = new Set();
    for (const p of photos) {
      let name = p.originalName;
      if (used.has(name)) {
        const ext = path.extname(name);
        const base = path.basename(name, ext);
        let n = 2;
        while (used.has(`${base}-${n}${ext}`)) n++;
        name = `${base}-${n}${ext}`;
      }
      used.add(name);
      archive.file(p.filePath, { name });
    }
    await archive.finalize();
  } catch (e) {
    next(e);
  }
}

export async function exportProjectCsv(req, res, next) {
  try {
    const project = await Project.findOne({
      _id: req.params.id,
      userId: req.user._id,
    });

    if (!project) {
      return res.status(404).json({
        success: false,
        message: "Project not found or unauthorized",
        errorCode: "NOT_FOUND",
      });
    }

    const photos = await Photo.find({
      userId: req.user._id,
      projectId: project._id,
    }).sort({ frameIndex: 1 });

    const header = "frame,filename,status,flagged,score,sharpness,face_score,expression,technical,ai_quality,duplicate_group";
    const rows = photos.map((p) =>
      [
        p.frameIndex,
        p.originalName,
        p.status,
        p.flagged,
        p.analysis?.finalScore ?? "",
        p.analysis?.sharpnessScore ?? "",
        p.analysis?.faceQualityScore ?? "",
        p.analysis?.expressionScore ?? "",
        p.analysis?.technicalScore ?? "",
        p.analysis?.aiQualityScore ?? "",
        p.duplicateGroupId ?? "",
      ]
        .map((v) => `"${String(v).replaceAll('"', '""')}"`)
        .join(",")
    );

    const safeName = project.name.replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
    res.type("text/csv").attachment(`${safeName}-export.csv`).send([header, ...rows].join("\n"));
  } catch (e) {
    next(e);
  }
}
