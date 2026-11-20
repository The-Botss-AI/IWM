'use client';

import { useMutation } from '@tanstack/react-query';

import { getApi } from '@/lib/api';

/**
 * Uploads one image (picture-choice options) through the standard files
 * pipeline and resolves with its public URL.
 */
export function useFormImageUpload() {
  return useMutation({
    meta: { errorTitle: "Couldn't upload the image" },
    mutationFn: async (file: File): Promise<string> => {
      const uploaded = await getApi().files.upload(file);
      if (!uploaded.url) throw new Error('The image has no public link');
      return uploaded.url;
    },
  });
}
