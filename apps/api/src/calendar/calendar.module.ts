import { Module } from '@nestjs/common';

import { MeetingsModule } from '../meetings/meetings.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({
  imports: [PrismaModule, MeetingsModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule {}
