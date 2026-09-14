const app = require('./api/index');

const PORT = process.env.PORT || 4173;
app.listen(PORT, () => {
  console.log(`kkal running at http://localhost:${PORT}`);
});
