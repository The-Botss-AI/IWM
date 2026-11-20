import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { FilesService } from '../files/files.service';
import { PrismaService } from '../prisma/prisma.service';

/** A PENDING upload no submission claimed within this window is abandoned. */
const STALE_MS = 24 * 60 * 60 * 1000;
const BATCH = 200;

/**
 * Hourly: deletes form uploads that were never attached to a submission
 * (closed tab, failed submit): the PENDING row first (so a late claim wins),
 * then its object. `@Cron` only runs in the worker (or the single `all`
 * process), never in the `api` role. An object storage refused to delete is
 * logged; its row is already gone, so it is not retried (rare, and the key
 * is random and unlisted).
 */
@Injectable()
export class FormUploadsSweeper {
  private readonly logger = new Logger(FormUploadsSweeper.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  @Cron('17 * * * *', { name: 'form-uploads-sweep' })
  async sweep(): Promise<number> {
    const cutoff = new Date(Date.now() - STALE_MS);
    let removed = 0;
    try {
      for (;;) {
        const stale = await this.prisma.client.formUpload.findMany({
          where: { status: 'PENDING', createdAt: { lt: cutoff } },
          select: { id: true, objectKey: true },
          orderBy: { createdAt: 'asc' },
          take: BATCH,
        });
        if (stale.length === 0) break;
        let failed = 0;
        for (const row of stale) {
          // Delete the row first, still PENDING: a submit that claims it in
          // the meantime wins and keeps its file. Only a row we removed loses
          // its object.
          const res = await this.prisma.client.formUpload.deleteMany({
            where: { id: row.id, status: 'PENDING' },
          });
          if (res.count !== 1) continue;
          if (await this.files.deleteObject(this.files.formsBucket, row.objectKey)) {
            removed += 1;
          } else {
            failed += 1;
          }
        }
        if (failed > 0)
          this.logger.warn(
            `${failed} abandoned form upload objects could not be deleted from storage`,
          );
        if (stale.length < BATCH) break;
      }
      if (removed > 0) this.logger.log(`Removed ${removed} abandoned form uploads`);
    } catch (err) {
      this.logger.error(`Form upload sweep failed: ${(err as Error)?.message ?? 'unknown'}`);
    }
    return removed;
  }
}
