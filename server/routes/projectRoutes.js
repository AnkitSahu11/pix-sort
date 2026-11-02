import express from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  createProject,
  listProjects,
  getProject,
  updateProject,
  deleteProject,
  exportProjectZip,
  exportProjectCsv,
} from "../controllers/projectController.js";

const router = express.Router();

router.use(requireAuth);

router.post("/", createProject);
router.get("/", listProjects);
router.get("/:id", getProject);
router.patch("/:id", updateProject);
router.delete("/:id", deleteProject);
router.get("/:id/export/zip", exportProjectZip);
router.get("/:id/export/csv", exportProjectCsv);

export default router;
