export function notFoundHandler(req, res) {
  res.status(404).json({
    flag: "F",
    statusCode: 404,
    msg: `Route not found: ${req.method} ${req.originalUrl}`,
    data: []
  });
}
