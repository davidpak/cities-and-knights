const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.send('Cities & Knights Server is live!');
});

module.exports = router;
