import express from 'express';
import cors from 'cors'
import { UrlValidation, VideoUrlValidation } from './public/Validation';
import Controllder from './public/Controller';
import Middleware from './public/Middleware';
const path = require('path');
const { isValidBody } = Middleware;


const server = express();
const PORT = process.env.PORT || 8000
// For parsing application/json
server.use(express.json());
server.use(cors())
const publicFilesDir = path.join(__dirname, 'public', 'files');
// server.use('/files', express.static(publicFilesDir));

// For parsing application/x-www-form-urlencoded
server.use(express.urlencoded({ extended: true }));

server.get('/', (_, res) => {
  res.send('Server working')
})
server.post("/url", UrlValidation, isValidBody, Controllder.fetchUrlData)
server.get("/files/:id", Controllder.fetchVideos)

server.listen(PORT, () => {
  console.log('server run on ' + PORT);
})