import axios from 'axios';
import fs from 'fs';
import { exec } from 'child_process';
const os = require('os');
const snoowrap = require('snoowrap');

// Generate a User-Agent string
function generateUserAgent(appName: string, appVersion: string) {
    const platform = os.platform();
    const release = os.release();
    const userAgent = `${appName}/${appVersion} (${platform} ${release})`;

    return userAgent;
}


export const resolutions = [
    '1080',
    '720',
    '480',
    '360',
    '240',
    '96',
];

export interface VideoInfo {
    fallbackUrl: string;
    isVideo: boolean;
    url: string;
    title: string;
    isMP4: boolean;
    duration?: number;
    hasAudio?: boolean;
    thumbnailURL?: string;
    postURL: string;
    videoType: string;
    filePath?: string;
}
const getFallbackUrl = (data: any) => {
    // return data.subreddit
    // return data.is_video
    if (data?.preview?.reddit_video_preview) {
        return data.preview.reddit_video_preview.fallback_url
    }
    if (data?.media?.reddit_video) {
        return data.media.reddit_video.fallback_url.split('?')[0]
    }
    if (data?.media?.oembed && data?.media?.oembed?.thumbnail_url?.endsWith('.gif')) {
        return data?.media?.oembed?.thumbnail_url
    }
    return data.url
}
// this is starting function that extract video info
export async function extractVideoInfo(url: string): Promise<any> {
    let fetchUrl = url.split('?')[0];
    if (!fetchUrl.endsWith('.json')) fetchUrl += '.json';
    const appName = 'justSaveVideo';
    const appVersion = '1.0.0';
    const clientId = '6E37fEtEJuh8KYCnX9gdow';
    const clientSecret = '_jnvIanyL0CnWtjFP1rmsMo5nNkSFA';
    const redirectUri = 'http://justsavevideo'; // Redirect URI configured in your Reddit app settings
    const userAgent = generateUserAgent(appName, appVersion)


    // Example: Fetching a JSON file from a subreddit

    // Example usage
    const response: any = await axios.get(fetchUrl,
        {
            headers: {
                'User-Agent': userAgent
            }
        }
    );

    if (response.status === 200) {
        const json = response.data
        const postData = json[0].data.children[0].data;

        const fallbackUrl = getFallbackUrl(postData)
        const hasAudio = fallbackUrl.endsWith('.gif') ? false : await hasAudioTrack(fallbackUrl.endsWith('.mp4'), postData.url)
        const info: VideoInfo = {
            fallbackUrl,
            isMP4: fallbackUrl.endsWith('.mp4'),
            url: postData.url,
            isVideo: postData.is_video,
            title: postData.title.replace(/[^\w\s]/gi, ''),
            hasAudio,
            postURL: url,
            videoType: fallbackUrl.includes('youtu.be') ? "youtube" : 'video',
            thumbnailURL: postData.thumbnail
        };
        return info;

    }
    else {

        return "this is not a valid link"
    }
}
export async function extractVideoInfo2(url: string): Promise<VideoInfo | string> {
    let fetchUrl = url.split('?')[0];
    if (!fetchUrl.endsWith('.json')) fetchUrl += '.json';

    const response: any = await axios(fetchUrl);
    if (response.status === 200) {
        const json = response.data
        const postData = json[0].data.children[0].data;

        if (postData.media) {

            if (postData.media.reddit_video) {
                const mediaData = postData.media.reddit_video;
                const fallbackUrl = mediaData ? mediaData.fallback_url.split('?')[0] : "";
                const hasAudio = mediaData ? await hasAudioTrack(fallbackUrl.endsWith('.mp4'), postData.url) : false
                const info: VideoInfo = {
                    fallbackUrl,
                    isMP4: fallbackUrl.endsWith('.mp4'),
                    url: postData.url,
                    isVideo: postData.is_video,
                    title: postData.title,
                    duration: mediaData?.duration,
                    hasAudio,
                    postURL: url,
                    videoType: 'video',
                    thumbnailURL: postData.thumbnail
                };
                return info;
            } else {
                const mediaData = postData.media.oembed;
                const info: VideoInfo = {
                    fallbackUrl: "",
                    isMP4: mediaData.type === 'video' ? true : false,
                    url: postData.url,
                    isVideo: postData.is_video,
                    thumbnailURL: mediaData?.thumbnail_url,
                    title: postData.title,
                    duration: mediaData?.duration,
                    videoType: 'video',
                    postURL: url
                };
                return info;
            }
        }
        else if (postData.preview) {
            const info: VideoInfo = {
                fallbackUrl: postData.preview.reddit_video_preview.fallback_url,
                isMP4: false,
                url: postData.url,
                isVideo: postData.is_video,
                thumbnailURL: 'null',
                title: postData.title,
                duration: 0,
                videoType: 'video',
                postURL: url
            };
            return info;

        }
        else {
            return "not a video link"
        }

    }
    return "this is not a valid link"
}
export const downloadAndSaveGif = async (url: string, destinationPath: string) => {
    try {
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
        });

        const writer = fs.createWriteStream(destinationPath);
        response.data.pipe(writer);

        await new Promise((resolve, reject) => {
            //@ts-ignore
            writer.on('finish', resolve);
            writer.on('error', reject);
        });

        console.log('GIF file downloaded and saved successfully!');
    } catch (error) {
        console.error('Error downloading GIF file:', error);
    }
};
export function convertGifToMp4(inputPath: string, outputPath: string) {
    return new Promise((resolve, reject) => {
        const command = `ffmpeg -i ${inputPath} -vf "fps=30, scale=640:-2" -c:v libx264 -pix_fmt yuv420p -movflags +faststart ${outputPath}`;

        exec(command, (error, stdout, stderr) => {
            if (error) {
                console.error('Error converting GIF to MP4:', error);
                reject(error);
            } else {
                console.log('GIF converted to MP4 successfully!');
                resolve("Hamza");
            }
        });
    });
}

export function extractAudioUrl(isMP4: boolean, url: string): string {
    return isMP4 ? `${url}/DASH_audio.mp4` : `${url}/audio`;
}

export async function hasAudioTrack(isMP4: boolean, url: string): Promise<boolean> {
    try {
        const res = await axios(extractAudioUrl(isMP4, url));
        return res.status === 200;

    } catch (error) {
        return false
    }

}

export function getBestResolution(fallbackUrl: string): string {
    return fallbackUrl.split('_')[1].split(".")[0];
}

export function getAvailableResolutions(fallbackUrl: string): Array<string> {
    return resolutions.slice(resolutions.indexOf(getBestResolution(fallbackUrl)));
}

export function extractVideoUrl(videoInfo: VideoInfo, resolution?: string): string {
    if (resolution === undefined) return videoInfo.fallbackUrl;
    if (videoInfo.isMP4) resolution += ".mp4";
    return `${videoInfo.fallbackUrl.split('_')[0]}_${resolution}`;
}
