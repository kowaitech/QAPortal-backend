import express from 'express';
import multer from 'multer';
import cloudinary from '../config/cloudinary.js';
import { auth, requireRole } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = express.Router();

// Configure multer for memory storage
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    limits: {
        fileSize: 50 * 1024, // 50KB limit for better performance
    },
    fileFilter: (req, file, cb) => {
        // Check if file is an image
        if (file.mimetype && file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            logger.warn('Rejected non-image upload', { userId: req.user?._id, mimetype: file.mimetype, filename: file.originalname });
            cb(new Error('Only image files are allowed'), false);
        }
    },
});

// Test upload route (requires auth) - returns base64 data URL (debugging)
router.post('/test-image', auth, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided' });
        }

        // Always use base64 fallback for testing
        const base64 = req.file.buffer.toString('base64');
        const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

        logger.info('Test image converted to base64', { userId: req.user?._id, filename: req.file.originalname });
        return res.json({
            message: 'Image uploaded successfully (test route)',
            url: dataUrl,
            publicId: null,
            fallback: true
        });
    } catch (error) {
        logger.error('Test upload error', { error });
        res.status(500).json({ message: 'Failed to upload image' });
    }
});

// Upload image to Cloudinary (requires auth)
router.post('/image', auth, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No image file provided' });
        }

        // Check if Cloudinary is configured
        if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
            // Fallback: Convert to base64 and return as data URL
            const base64 = req.file.buffer.toString('base64');
            const dataUrl = `data:${req.file.mimetype};base64,${base64}`;
            logger.warn('Cloudinary not configured - returning base64 fallback', { userId: req.user?._id });
            return res.json({ message: 'Image uploaded successfully (base64 fallback)', url: dataUrl, publicId: null, fallback: true });
        }

        // Upload to Cloudinary
        const result = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                {
                    resource_type: 'image',
                    folder: 'exam-answers', // Organize images in a folder
                    public_id: `answer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    transformation: [
                        { width: 1200, height: 1200, crop: 'limit' }, // Resize if too large
                        { quality: 'auto' }, // Auto quality optimization
                        { format: 'auto' } // Auto format selection
                    ]
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            ).end(req.file.buffer);
        });
        logger.info('Image uploaded to Cloudinary', { userId: req.user?._id, publicId: result.public_id, url: result.secure_url });
        res.json({ message: 'Image uploaded successfully', url: result.secure_url, publicId: result.public_id });
    } catch (error) {
        logger.error('Upload error', { error });

        // Fallback to base64 if Cloudinary fails
        try {
            const base64 = req.file?.buffer?.toString('base64');
            if (!base64) throw new Error('No file buffer available for fallback');
            const dataUrl = `data:${req.file.mimetype};base64,${base64}`;

            logger.warn('Cloudinary upload failed, returning base64 fallback', { userId: req.user?._id, error });
            return res.json({ message: 'Image uploaded successfully (base64 fallback)', url: dataUrl, publicId: null, fallback: true });
        } catch (fallbackError) {
            logger.error('Upload fallback failed', { error: fallbackError });
            res.status(500).json({ message: 'Failed to upload image' });
        }
    }
});

// Delete image from Cloudinary
router.delete('/image', auth, requireRole('staff'), async (req, res) => {
    try {
        const { publicId } = req.body;

        if (!publicId) {
            return res.status(400).json({ message: 'Public ID is required' });
        }

        // Delete from Cloudinary
        const result = await cloudinary.uploader.destroy(publicId);

        if (result.result === 'ok') {
            logger.info('Deleted image from Cloudinary', { adminId: req.user?._id, publicId });
            res.json({ message: 'Image deleted successfully' });
        } else {
            logger.warn('Cloudinary destroy returned unexpected result', { adminId: req.user?._id, publicId, result });
            res.status(404).json({ message: 'Image not found or already deleted' });
        }
    } catch (error) {
        logger.error('Delete image failed', { error });
        res.status(500).json({
            message: 'Failed to delete image'
        });
    }
});

// Extract public ID from Cloudinary URL
export const extractPublicId = (url) => {
    if (!url || !url.includes('cloudinary.com')) {
        logger.warn('extractPublicId called with non-cloudinary url', { url });
        return null;
    }

    const parts = url.split('/');
    const filename = parts[parts.length - 1];
    const publicId = filename.split('.')[0];

    // Reconstruct the full public ID with folder
    const folderIndex = url.indexOf('/exam-answers/');
    if (folderIndex !== -1) {
        const folderPath = url.substring(folderIndex + 1, url.lastIndexOf('/'));
        const fullId = `${folderPath}/${publicId}`;
        logger.info('Extracted publicId from cloudinary url', { url, publicId: fullId });
        return fullId;
    }
    logger.info('Extracted publicId from cloudinary url (no folder)', { url, publicId });
    return publicId;
};

export default router;
