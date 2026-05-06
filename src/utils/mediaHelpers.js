// src/utils/mediaHelpers.js
import { compressMedia } from './mediaCompression';
import { uploadToR2 } from './r2Storage';

// R2 handles object lifecycle via bucket rules — no TTL metadata needed.

/**
 * Starts audio recording. Returns a MediaRecorder instance.
 */
export const startVoiceRecording = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    const chunks = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder._chunks = chunks;
    recorder._stream = stream;
    recorder.start();
    return recorder;
  } catch (error) {
    console.error("Error accessing microphone:", error);
    throw error;
  }
};

/**
 * Stops recording and returns the audio blob.
 */
export const stopVoiceRecording = (recorder) => {
  return new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(recorder._chunks, { type: 'audio/webm' });
      recorder._stream?.getTracks().forEach(t => t.stop());
      resolve(blob);
    };
    recorder.stop();
  });
};

/**
 * Uploads a file to Firebase Storage with client-side compression and TTL metadata.
 * @param {File} file - The file to upload
 * @param {string} folder - Storage folder path
 * @param {string} tier - User tier: 'free' | 'lite' | 'pro'
 * @param {number} ttlDays - Days until server copy should expire
 * @param {string} preset - Compression preset: 'chat' | 'post' | 'avatar' | 'background'
 * @returns {Promise<string>} Download URL
 */
export const uploadMediaFile = async (file, folder = 'chat_media', tier = 'free', ttlDays = 7, preset = 'chat') => {
  const compressed = await compressMedia(file, tier, preset);
  const kind = folder.startsWith('post') ? 'post' : 'post';
  const { url } = await uploadToR2(compressed, kind);
  return url;
};

/**
 * Uploads a blob (like voice recording) to R2.
 */
export const uploadBlob = async (blob, folder = 'voice_notes', ext = 'webm') => {
  const file = new File([blob], `recording.${ext}`, { type: blob.type || `audio/${ext}` });
  const { url } = await uploadToR2(file, 'post');
  return url;
};

/**
 * Helper to check if a string is a YouTube link and extract the ID.
 */
export const getYouTubeID = (url) => {
  if (!url || typeof url !== 'string') return null;
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
};