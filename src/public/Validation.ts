const { check } = require("express-validator");
export const UrlValidation = [
  check("url", "Please Provide a valid url").not().isEmpty(),
];
export const VideoUrlValidation = [
  check("audioUrl", "Please Provide a valid audioUrl").not().isEmpty(),
  check("videoUrl", "Please Provide a valid videoUrl").not().isEmpty(),
];
