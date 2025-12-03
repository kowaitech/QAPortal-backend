import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    logger.warn('Cloudinary configuration incomplete. Image uploads may fail.', {
        CLOUDINARY_CLOUD_NAME: !!CLOUDINARY_CLOUD_NAME,
        CLOUDINARY_API_KEY: !!CLOUDINARY_API_KEY,
        CLOUDINARY_API_SECRET: !!CLOUDINARY_API_SECRET
    });
}

// Configure Cloudinary with secure defaults
cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
});

// Helper: upload a Buffer via upload_stream
export const uploadBuffer = (buffer, options = {}) => {
    return new Promise((resolve, reject) => {
        try {
            const stream = cloudinary.uploader.upload_stream(options, (error, result) => {
                if (error) return reject(error);
                return resolve(result);
            });
            stream.end(buffer);
        } catch (err) {
            reject(err);
        }
    });
};

// Helper: upload base64 string or URL directly
export const upload = (source, options = {}) => cloudinary.uploader.upload(source, options);

// Helper: destroy by public id
export const destroy = (publicId, options = {}) => cloudinary.uploader.destroy(publicId, options);

logger.info('Cloudinary configured', { cloud: !!CLOUDINARY_CLOUD_NAME });

export default cloudinary;
