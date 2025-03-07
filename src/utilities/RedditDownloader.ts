import { createWriteStream, unlink, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import ffmpeg from 'fluent-ffmpeg';
import fetch from 'node-fetch';
import { DOMParser } from 'xmldom';
//@ts-ignore
import { parse } from 'mpd-parser';
import { v4 as uuidv4 } from 'uuid';
import { VideoInfo } from './Helper';

// User agent for requests
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

export interface RedditMediaInfo {
    videoUrl: string;
    audioUrl: string | null;
    title: string;
    originalPostUrl: string;
}

export class RedditDownloader {
    private tempDir: string;
    private outputDir: string;

    constructor(baseDir: string) {
        this.tempDir = join(baseDir, 'temp');
        this.outputDir = join(baseDir, 'files');

        // Create directories if they don't exist
        if (!existsSync(this.tempDir)) {
            mkdirSync(this.tempDir, { recursive: true });
        }

        if (!existsSync(this.outputDir)) {
            mkdirSync(this.outputDir, { recursive: true });
        }
    }

    // Function to download file from URL
    private async downloadFile(url: string, outputPath: string, referer = 'https://www.reddit.com/'): Promise<void> {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Referer': referer,
                    'Origin': 'https://www.reddit.com'
                },
                redirect: 'follow'
            });

            if (!response.ok) {
                throw new Error(`Failed to download file: ${response.statusText} (${response.status})`);
            }

            const fileStream = createWriteStream(outputPath);
            const buffer = await response.buffer();

            return new Promise((resolve, reject) => {
                fileStream.write(buffer);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
                fileStream.on('error', (err) => {
                    unlink(outputPath, () => { });
                    reject(err);
                });
                fileStream.end();
            });
        } catch (error: any) {
            throw new Error(`Download failed: ${error.message}`);
        }
    }

    // Function to fetch content from URL
    private async fetchContent(url: string, referer = 'https://www.reddit.com/'): Promise<string> {
        try {
            const response = await fetch(url, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Referer': referer,
                    'Origin': 'https://www.reddit.com'
                },
                redirect: 'follow'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch content: ${response.statusText} (${response.status})`);
            }

            return await response.text();
        } catch (error: any) {
            throw new Error(`Fetch failed: ${error.message}`);
        }
    }

    // Function to get JSON data from Reddit post URL
    private async getRedditPostJSON(url: string): Promise<any> {
        try {
            // Convert URL to JSON endpoint
            const jsonUrl = url.endsWith('/') ? `${url}.json` : `${url}/.json`;

            const response = await fetch(jsonUrl, {
                headers: {
                    'User-Agent': USER_AGENT,
                    'Accept': 'application/json'
                },
                redirect: 'follow'
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch Reddit data: ${response.statusText} (${response.status})`);
            }

            return await response.json();
        } catch (error: any) {
            throw new Error(`Failed to fetch Reddit post data: ${error.message}`);
        }
    }

    // Function to parse DASH manifest and get best quality streams
    private async parseDASHManifest(dashUrl: string, originalPostUrl: string): Promise<{ bestVideo: any, bestAudio: any }> {
        try {
            console.log('Analyzing DASH manifest...');
            const dashContent = await this.fetchContent(dashUrl, originalPostUrl);

            // Parse the MPD
            const manifest = parse(dashContent);

            // Find video with the highest bandwidth
            let bestVideo = { bandwidth: 0, url: '' };
            let bestAudio = { bandwidth: 0, url: '' };

            manifest.playlists.forEach((playlist: any) => {
                // Determine if this is video or audio
                const isVideo = playlist.attributes.BANDWIDTH > 100000 &&
                    (playlist.attributes.codecs?.includes('avc') ||
                        !playlist.attributes.codecs?.includes('mp4a'));

                if (isVideo && playlist.attributes.BANDWIDTH > bestVideo.bandwidth) {
                    bestVideo = {
                        bandwidth: playlist.attributes.BANDWIDTH,
                        url: playlist.uri,
                        //@ts-ignore
                        resolution: playlist.attributes.RESOLUTION
                    };
                } else if (!isVideo && playlist.attributes.BANDWIDTH > bestAudio.bandwidth) {
                    bestAudio = {
                        bandwidth: playlist.attributes.BANDWIDTH,
                        url: playlist.uri
                    };
                }
            });

            // If the URLs are relative, make them absolute
            const baseUrl = dashUrl.substring(0, dashUrl.lastIndexOf('/') + 1);

            if (bestVideo.url && !bestVideo.url.startsWith('http')) {
                bestVideo.url = new URL(bestVideo.url, baseUrl).toString();
            }

            if (bestAudio.url && !bestAudio.url.startsWith('http')) {
                bestAudio.url = new URL(bestAudio.url, baseUrl).toString();
            }

            return { bestVideo, bestAudio };
        } catch (error: any) {
            console.error('Error parsing DASH manifest:', error.message);
            // Return empty to indicate we should fall back to direct URLs
            return { bestVideo: { url: '' }, bestAudio: { url: '' } };
        }
    }

    // Function to extract direct audio URL with fallbacks
    private getAudioUrlVariants(baseUrl: string): string[] {
        return [
            // Standard audio URL
            `${baseUrl}DASH_audio.mp4`,
            // Alternative formats
            `${baseUrl}audio`,
            `${baseUrl}DASH_audio`,
            `${baseUrl}DASH_AUDIO_128.mp4`,
            `${baseUrl}DASH_AUDIO_64.mp4`
        ];
    }

    // Function to try multiple audio URLs and return the first successful one
    private async findWorkingAudioUrl(audioUrls: string[], originalPostUrl: string): Promise<string | null> {
        console.log('Trying multiple audio sources...');

        for (const url of audioUrls) {
            try {
                console.log(`Trying audio URL: ${url}`);

                // Just check if the URL is accessible
                const response = await fetch(url, {
                    method: 'HEAD',
                    headers: {
                        'User-Agent': USER_AGENT,
                        'Referer': originalPostUrl,
                        'Origin': 'https://www.reddit.com'
                    },
                    redirect: 'follow'
                });

                if (response.ok) {
                    console.log(`Found working audio URL: ${url}`);
                    return url;
                }
            } catch (error) {
                // Continue to next URL on error
                console.log(`Audio URL failed: ${url}`);
            }
        }

        return null; // No working URL found
    }

    // Function to extract media URLs from Reddit post JSON
    private async extractMediaUrls(json: any, originalPostUrl: string): Promise<RedditMediaInfo> {
        try {
            // Navigate to the media object - try different possible locations
            const post = json[0].data.children[0].data;
            const media = post.media;
            const secure_media = post.secure_media;
            const crosspost_parent_list = post.crosspost_parent_list;

            let videoData;

            // Try to find video data in different possible locations
            if (media && media.reddit_video) {
                videoData = media.reddit_video;
            } else if (secure_media && secure_media.reddit_video) {
                videoData = secure_media.reddit_video;
            } else if (crosspost_parent_list && crosspost_parent_list[0] &&
                crosspost_parent_list[0].media &&
                crosspost_parent_list[0].media.reddit_video) {
                videoData = crosspost_parent_list[0].media.reddit_video;
            } else {
                throw new Error('No video found in this Reddit post');
            }

            // Initialize URLs
            let videoUrl = '';
            let dashUrl = '';
            let hls_url = '';

            // Get all available URLs
            if (videoData.fallback_url) {
                videoUrl = videoData.fallback_url;
            }

            if (videoData.dash_url) {
                dashUrl = videoData.dash_url;
            } else if (videoUrl) {
                // If dash_url isn't available, create from fallback_url
                dashUrl = videoUrl.split('DASH_')[0] + 'DASHPlaylist.mpd';
            }

            if (videoData.hls_url) {
                hls_url = videoData.hls_url;
            }

            // Parse DASH manifest to get best quality if available
            let bestDashVideo = { url: '' };
            let bestDashAudio = { url: '' };

            if (dashUrl) {
                const { bestVideo, bestAudio } = await this.parseDASHManifest(dashUrl, originalPostUrl);
                bestDashVideo = bestVideo;
                bestDashAudio = bestAudio;
            }

            // Select the best video URL available
            let finalVideoUrl = bestDashVideo.url || videoUrl;

            // If we still don't have a video URL, this is an error
            if (!finalVideoUrl) {
                throw new Error('Could not find a valid video URL');
            }

            // For audio, we'll try multiple potential URLs
            let audioBaseUrl = '';
            if (videoUrl) {
                // Extract the base URL from the video URL
                const parts = videoUrl.split('DASH_');
                if (parts.length > 1) {
                    audioBaseUrl = parts[0];
                }
            }

            let audioUrls: string[] = [];

            // Add the best DASH audio if available
            if (bestDashAudio.url) {
                audioUrls.push(bestDashAudio.url);
            }

            // Add all potential direct audio URLs
            if (audioBaseUrl) {
                audioUrls = audioUrls.concat(this.getAudioUrlVariants(audioBaseUrl));
            }

            // Try to find a working audio URL
            const finalAudioUrl = await this.findWorkingAudioUrl(audioUrls, originalPostUrl);

            return {
                videoUrl: finalVideoUrl,
                audioUrl: finalAudioUrl,
                title: post.title.replace(/[^\w\s]/gi, '_'),
                originalPostUrl
            };
        } catch (error: any) {
            throw new Error(`Failed to extract media URLs: ${error.message}`);
        }
    }

    // Function to merge video and audio using fluent-ffmpeg
    private mergeVideoAndAudio(videoPath: string, audioPath: string, outputPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(videoPath)
                .input(audioPath)
                .outputOptions([
                    '-c:v copy',       // Copy video codec without re-encoding
                    '-c:a aac',        // Use AAC for audio
                    '-map 0:v:0',      // Map first stream from first input (video)
                    '-map 1:a:0',      // Map first stream from second input (audio)
                    '-shortest',       // End when shortest input ends
                    '-strict experimental'  // Allow experimental codecs
                ])
                .output(outputPath)
                .on('start', () => {
                    console.log('Starting ffmpeg process...');
                })
                .on('progress', (progress) => {
                    if (progress.percent) {
                        process.stdout.write(`Merging: ${Math.round(progress.percent)}% complete\r`);
                    }
                })
                .on('end', () => {
                    console.log('\nMerging completed successfully');
                    resolve();
                })
                .on('error', (err) => {
                    console.error('Error during merging:', err);
                    reject(err);
                })
                .run();
        });
    }

    // Main function to download Reddit video
    public async downloadRedditVideo(redditUrl: string): Promise<VideoInfo> {
        // Generate a unique ID for this download session to prevent conflicts
        const sessionId = uuidv4();
        const tempVideoPath = join(this.tempDir, `video_${sessionId}.mp4`);
        const tempAudioPath = join(this.tempDir, `audio_${sessionId}.mp4`);

        try {
            console.log('Fetching Reddit post data...');
            const json = await this.getRedditPostJSON(redditUrl);

            const { videoUrl, audioUrl, title, originalPostUrl } = await this.extractMediaUrls(json, redditUrl);
            console.log(`\nFound video: "${title}"`);

            // Create a safe filename
            const safeTitle = title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
            const outputPath = join(this.outputDir, `${safeTitle}.mp4`);
            const relativePath = `files/${safeTitle}.mp4`;

            console.log('\nDownloading video...');
            await this.downloadFile(videoUrl, tempVideoPath, redditUrl);
            console.log('Video download complete!');

            let hasAudio = false;

            if (audioUrl) {
                console.log('Downloading audio...');
                try {
                    await this.downloadFile(audioUrl, tempAudioPath, redditUrl);
                    console.log('Audio download complete!');
                    hasAudio = true;
                } catch (error) {
                    console.log(`Audio download failed: ${error}`);
                }
            } else {
                console.log('No audio track available for this video');
            }

            if (hasAudio) {
                console.log('\nMerging video and audio...');
                try {
                    await this.mergeVideoAndAudio(tempVideoPath, tempAudioPath, outputPath);
                    console.log('\n✅ Download completed successfully!');
                    console.log(`Video saved to: ${outputPath}`);
                } catch (error) {
                    console.log('Merging failed, saving video without audio...');
                    copyFileSync(tempVideoPath, outputPath);
                    console.log(`Video saved without audio to: ${outputPath}`);
                }
            } else {
                console.log('Saving video without audio...');
                copyFileSync(tempVideoPath, outputPath);
                console.log(`Video saved to: ${outputPath}`);
            }

            // Clean up temp files
            try {
                if (existsSync(tempVideoPath)) unlinkSync(tempVideoPath);
                if (existsSync(tempAudioPath) && hasAudio) unlinkSync(tempAudioPath);
            } catch (e) {
                // Ignore errors during cleanup
            }

            // Return video info for API response
            return {
                fallbackUrl: videoUrl,
                isVideo: true,
                url: originalPostUrl,
                title: title,
                isMP4: videoUrl.endsWith('.mp4'),
                hasAudio: hasAudio,
                thumbnailURL: json[0]?.data?.children[0]?.data?.thumbnail || '',
                postURL: originalPostUrl,
                videoType: 'video',
                filePath: relativePath
            };

        } catch (error: any) {
            console.error(`Error: ${error.message}`);
            // Clean up temp files on error
            try {
                if (existsSync(tempVideoPath)) unlinkSync(tempVideoPath);
                if (existsSync(tempAudioPath)) unlinkSync(tempAudioPath);
            } catch (e) {
                // Ignore errors during cleanup
            }

            throw error;
        }
    }
}
