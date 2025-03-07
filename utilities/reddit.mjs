// Reddit Video Downloader Script with Access Control Fix
// Dependencies: fluent-ffmpeg, node-fetch, mpd-parser, xmldom
// Installation: npm install fluent-ffmpeg node-fetch mpd-parser xmldom
// Usage: Run with Node.js and provide a Reddit post URL



import { createWriteStream, unlink, existsSync, mkdirSync, copyFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import ffmpeg from 'fluent-ffmpeg';
import fetch from 'node-fetch';
import { DOMParser } from 'xmldom';
import { parse } from 'mpd-parser';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Add these lines near the top of your file (after other imports)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


// Create readline interface for user input
const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});

// User agent for requests
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

// Function to download file from URL
async function downloadFile(url, outputPath, referer = 'https://www.reddit.com/') {
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
    } catch (error) {
        throw new Error(`Download failed: ${error.message}`);
    }
}

// Function to fetch content from URL
async function fetchContent(url, referer = 'https://www.reddit.com/') {
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
    } catch (error) {
        throw new Error(`Fetch failed: ${error.message}`);
    }
}

// Function to get JSON data from Reddit post URL
async function getRedditPostJSON(url) {
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
    } catch (error) {
        throw new Error(`Failed to fetch Reddit post data: ${error.message}`);
    }
}

// Function to parse DASH manifest and get best quality streams
async function parseDASHManifest(dashUrl, originalPostUrl) {
    try {
        console.log('Analyzing DASH manifest...');
        const dashContent = await fetchContent(dashUrl, originalPostUrl);

        // Parse the MPD
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(dashContent, 'text/xml');

        const manifest = parse(dashContent);

        // Find video with the highest bandwidth
        let bestVideo = { bandwidth: 0, url: '' };
        let bestAudio = { bandwidth: 0, url: '' };

        manifest.playlists.forEach(playlist => {
            // Determine if this is video or audio
            const isVideo = playlist.attributes.BANDWIDTH > 100000 &&
                (playlist.attributes.codecs?.includes('avc') ||
                    !playlist.attributes.codecs?.includes('mp4a'));

            if (isVideo && playlist.attributes.BANDWIDTH > bestVideo.bandwidth) {
                bestVideo = {
                    bandwidth: playlist.attributes.BANDWIDTH,
                    url: playlist.uri,
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

        if (bestVideo.url) {
            console.log(`Found best video: ${bestVideo.resolution?.width}x${bestVideo.resolution?.height} (${(bestVideo.bandwidth / 1000000).toFixed(2)} Mbps)`);
        }

        if (bestAudio.url) {
            console.log(`Found best audio: ${(bestAudio.bandwidth / 1000).toFixed(0)} kbps`);
        }

        return { bestVideo, bestAudio };
    } catch (error) {
        console.error('Error parsing DASH manifest:', error.message);
        // Return empty to indicate we should fall back to direct URLs
        return { bestVideo: { url: '' }, bestAudio: { url: '' } };
    }
}

// Function to extract direct audio URL with fallbacks
function getAudioUrlVariants(baseUrl) {
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
async function findWorkingAudioUrl(audioUrls, originalPostUrl) {
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
async function extractMediaUrls(json, originalPostUrl) {
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

        console.log('\nVideo sources found:');
        if (videoUrl) console.log(`- Direct video: ${videoUrl}`);
        if (dashUrl) console.log(`- DASH playlist: ${dashUrl}`);
        if (hls_url) console.log(`- HLS playlist: ${hls_url}`);

        // Parse DASH manifest to get best quality if available
        let bestDashVideo = { url: '' };
        let bestDashAudio = { url: '' };

        if (dashUrl) {
            const { bestVideo, bestAudio } = await parseDASHManifest(dashUrl, originalPostUrl);
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

        let audioUrls = [];

        // Add the best DASH audio if available
        if (bestDashAudio.url) {
            audioUrls.push(bestDashAudio.url);
        }

        // Add all potential direct audio URLs
        if (audioBaseUrl) {
            audioUrls = audioUrls.concat(getAudioUrlVariants(audioBaseUrl));
        }

        // Try to find a working audio URL
        const finalAudioUrl = await findWorkingAudioUrl(audioUrls, originalPostUrl);

        console.log('\nSelected sources:');
        console.log(`- Video: ${finalVideoUrl}`);
        if (finalAudioUrl) console.log(`- Audio: ${finalAudioUrl}`);
        else console.log('- No working audio found');

        return {
            videoUrl: finalVideoUrl,
            audioUrl: finalAudioUrl,
            title: post.title.replace(/[^\w\s]/gi, '_'),
            originalPostUrl
        };
    } catch (error) {
        throw new Error(`Failed to extract media URLs: ${error.message}`);
    }
}

// Function to merge video and audio using fluent-ffmpeg
function mergeVideoAndAudio(videoPath, audioPath, outputPath) {
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
                console.error('Error during merging:', err.message);
                reject(err);
            })
            .run();
    });
}

// Main function to download Reddit video
async function downloadRedditVideo(redditUrl) {
    try {
        console.log('Fetching Reddit post data...');
        const json = await getRedditPostJSON(redditUrl);

        const { videoUrl, audioUrl, title, originalPostUrl } = await extractMediaUrls(json, redditUrl);
        console.log(`\nFound video: "${title}"`);

        // Create temp directory if it doesn't exist
        const tempDir = join(__dirname, 'temp');
        if (!existsSync(tempDir)) {
            mkdirSync(tempDir);
        }

        // Create downloads directory if it doesn't exist
        const outputDir = join(__dirname, 'downloads');
        if (!existsSync(outputDir)) {
            mkdirSync(outputDir);
        }

        // Create a safe filename
        const safeTitle = title.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
        const outputPath = join(outputDir, `${safeTitle}.mp4`);

        // Set file paths for manual download
        const videoPath = join(tempDir, 'video.mp4');
        const audioPath = join(tempDir, 'audio.mp4');

        console.log('\nDownloading video...');
        await downloadFile(videoUrl, videoPath, redditUrl);
        console.log('Video download complete!');

        let hasAudio = false;

        if (audioUrl) {
            console.log('Downloading audio...');
            try {
                await downloadFile(audioUrl, audioPath, redditUrl);
                console.log('Audio download complete!');
                hasAudio = true;
            } catch (error) {
                console.log(`Audio download failed: ${error.message}`);
            }
        } else {
            console.log('No audio track available for this video');
        }

        if (hasAudio) {
            console.log('\nMerging video and audio...');
            try {
                await mergeVideoAndAudio(videoPath, audioPath, outputPath);
                console.log('\n✅ Download completed successfully!');
                console.log(`Video saved to: ${outputPath}`);
            } catch (error) {
                console.log('Merging failed, saving video without audio...');
                copyFileSync(videoPath, outputPath);
                console.log(`Video saved without audio to: ${outputPath}`);
            }
        } else {
            console.log('Saving video without audio...');
            copyFileSync(videoPath, outputPath);
            console.log(`Video saved to: ${outputPath}`);
        }

        // Clean up temp files
        try {
            if (existsSync(videoPath)) unlinkSync(videoPath);
            if (existsSync(audioPath) && hasAudio) unlinkSync(audioPath);
        } catch (e) {
            // Ignore errors during cleanup
        }

    } catch (error) {
        console.error(`Error: ${error.message}`);
    }
}

// Main execution with URL validation
function main() {
    rl.question('Enter Reddit post URL: ', (url) => {
        if (!url.includes('reddit.com')) {
            console.error('Invalid URL. Please enter a valid Reddit post URL.');
            rl.close();
            return;
        }

        downloadRedditVideo(url).finally(() => {
            rl.close();
        });
    });
}

main();