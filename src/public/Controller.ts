import { MiddlewareType } from "../shared/types";
import { Request, Response, NextFunction } from "express";
import { exec } from 'child_process';
import { StatusCode } from "../enums/Enum";
import Utilities from "../utilities/utilities";
import { convertGifToMp4, downloadAndSaveGif, extractVideoInfo } from "../utilities/Helper";
import youtubeDl from "youtube-dl-exec";
import { RedditDownloader } from "../utilities/RedditDownloader";
import path from 'path';
import fs from 'fs';
const VidzitDL = require('vidzit-dl');

class Controllder {
    static fetchUrlData: MiddlewareType = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        const { url } = req.body;

        try {
            // Check if the URL is a Reddit URL
            if (url.includes('reddit.com') || url.includes('redd.it')) {
                console.log('Processing as Reddit URL:', url);

                // Create instance of RedditDownloader with the correct path
                const redditDownloader = new RedditDownloader(path.join(__dirname), {
                    clientId: '',
                    clientSecret: '',
                    username: '',
                    password: '',
                });

                try {
                    await redditDownloader.testOAuthToken();

                    const videoInfo = await redditDownloader.downloadRedditVideo(url);
                    res.json(videoInfo);
                    return;
                } catch (error: any) {
                    console.error('Reddit downloader error:', error);
                    // Fall back to the original method if Reddit downloader fails
                }
            }

            // Original implementation as fallback
            const response: any = await extractVideoInfo(url);
            const filePathNew = `files/${response.title.replace(/ /g, "_")}.mp4`;
            const filePath = path.join(__dirname, filePathNew);

            fs.readdir(path.join(__dirname, 'files'), async (err: any, files: any) => {
                if (err) {
                    console.error('Error reading directory:', err);
                    return;
                }
                // Filter the files based on the matching string
                const matchingFiles = files.filter((file: any) => file.includes(response.title.replace(/ /g, "_")));
                if (matchingFiles.length === 0) {
                    // console.log('No matching files found.');
                    if (response && typeof (response) != "string") {
                        if (response.isVideo && response.hasAudio) {
                            // res.send(response)
                            const videoUrl = response.url + "/DASH_220.mp4"
                            const audioUrl = response.hasAudio ? response.url + "/DASH_audio.mp4" : "";
                            // Path to store the downloaded file
                            exec(`ffmpeg -i ${videoUrl} -i ${audioUrl} -c:v copy -c:a aac ${filePath}`, (err, stdout, stderr) => {
                                if (!err) {
                                    // return filePath
                                    if (typeof (response) != "string") {
                                        res.json({ ...response, filePath: filePathNew })
                                    }
                                }
                                else {
                                    res
                                        .status(StatusCode.BAD_REQUEST)
                                        .json(
                                            Utilities.messageGenerater(
                                                err.message
                                            )
                                        );
                                }
                            });
                        }
                        else if (response.fallbackUrl.includes('.mp4')) {
                            const videoUrl = response.fallbackUrl
                            convertGifToMp4(videoUrl, filePath)
                                .then(() => {
                                    res.json({ ...response, filePath: filePathNew })

                                })
                                .catch((error) => {
                                    res
                                        .status(StatusCode.BAD_REQUEST)
                                        .json(
                                            Utilities.messageGenerater(
                                                error.message
                                            )
                                        );
                                    console.error('Conversion failed:', error);
                                });
                        }
                        else if (response.url.includes('youtu.be')) {

                            const options = {
                                output: filePath,
                            };

                            youtubeDl(response.url, options)
                                .then(() => {
                                    res.json({ ...response, filePath: filePathNew })
                                })
                                .catch((error) => {
                                    res
                                        .status(StatusCode.BAD_REQUEST)
                                        .json(
                                            Utilities.messageGenerater(
                                                error.message
                                            )
                                        );
                                    console.error('Error downloading video:', error);
                                });
                        }
                        else if (response.fallbackUrl.includes('.gif')) {
                            const videoUrl = response.fallbackUrl
                            convertGifToMp4(videoUrl, filePath)
                                .then(() => {
                                    res.json({ ...response, filePath: filePathNew })

                                })
                                .catch((error) => {
                                    res
                                        .status(StatusCode.BAD_REQUEST)
                                        .json(
                                            Utilities.messageGenerater(
                                                error.message
                                            )
                                        );
                                });
                            // await downloadAndSaveGif(videoUrl, path.join(__dirname, `files/${response.title.replace(/ /g, "_")}.gif`))
                        }
                        else {
                            await VidzitDL.initialize(url);
                            // let video1 = await VidzitDL.initialize(url);
                            // console.log(video1.videoInfo);
                            // console.log(response)
                        }
                    }
                    else {
                        throw new Error(response)
                    }
                } else {
                    // console.log('Matching files:', matchingFiles);
                    res.json({ ...response, filePath: filePathNew })

                }
            });

        } catch (error: any) {
            res
                .status(StatusCode.BAD_REQUEST)
                .json(
                    Utilities.messageGenerater(
                        error.message
                    )
                );
        }
    };

    static fetchVideos: MiddlewareType = async (
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> => {
        try {
            const { id } = req.params;
            // Path to store the downloaded file
            // console.log('id', id);


            fs.readdir(path.join(__dirname, 'files'), async (err: any, files: any) => {
                if (err) {
                    console.error('Error reading directory:', err);
                    return;
                }
                // Filter the files based on the matching string
                const matchingFiles = files.filter((file: any) => file.includes(id));
                // console.log(matchingFiles);

                if (matchingFiles.length > 0) {
                    const filePathNew = `files/${matchingFiles[0]}`;
                    const filePath = path.join(__dirname, filePathNew);
                    res.download(
                        filePath,
                        "downloaded-book.mp4", // Remember to include file extension
                        (err) => {
                            if (err) {
                                res.send({
                                    error: err,
                                    msg: "Problem downloading the file"
                                })
                            }
                        });
                }
                else {
                    res
                        .status(StatusCode.BAD_REQUEST)
                        .json(
                            Utilities.messageGenerater(
                                "no file exist"
                            )
                        );
                }
            })
            // res.send({ ...response, filePath })

        } catch (error: any) {
            res
                .status(StatusCode.BAD_REQUEST)
                .json(
                    Utilities.messageGenerater(
                        error.message
                    )
                );
        }
    };

}

export default Controllder;
