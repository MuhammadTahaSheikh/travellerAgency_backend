import { Response } from 'express';
import { AuthRequest } from '../types';

export async function uploadAttachment(req: AuthRequest, res: Response) {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  const filePath = `/uploads/${req.file.filename}`;
  return res.json({
    success: true,
    data: {
      fileName: req.file.originalname,
      filePath,
      attachmentPath: filePath,
    },
  });
}
