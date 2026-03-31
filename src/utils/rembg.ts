import { spawn } from "child_process";
import path from "path";

const getPythonCommand = () => {
  const configured = process.env.REMBG_PYTHON;
  if (configured && configured.trim()) return configured.trim();
  return "python3";
};

export const isRembgEnabled = () => {
  const flag = (process.env.REMBG_ENABLED || "").toString().trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
};

export const runRembg = async (inputPath: string, outputPath: string) => {
  const scriptPath = path.join(process.cwd(), "scripts", "rembg_process.py");
  const python = getPythonCommand();
  const timeoutMs = Math.max(5_000, parseInt(process.env.REMBG_TIMEOUT_MS || "60000", 10) || 60000);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, [scriptPath, inputPath, outputPath], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stderr = "";
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });

    const t = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
      }
      reject(new Error("rembg timed out"));
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || "rembg failed"));
    });
  });
};

