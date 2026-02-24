export const notFoundHandler = (req, res, next) => {
  res.status(404).json({ message: "Not found" });
};

export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";
  res.status(statusCode).json({ message });
};

