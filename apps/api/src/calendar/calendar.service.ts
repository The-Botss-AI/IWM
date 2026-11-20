import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@botss/database';
import {
  MEETING_LIST_MAX_DAYS,
  type CalendarEvent,
  type CalendarEventType,
} from '@botss/shared-types';

import { AddonsService } from '../addons/addons.service';
import type { UserScope } from '../common/decorators/user-scope.decorator';
import { projectVisibilityWhere } from '../common/project-access';
import { isSupportRequest } from '../common/request-context';
import { MeetingsService } from '../meetings/meetings.service';
import { PrismaService } from '../prisma/prisma.service';

/** Meeting occurrences one calendar range returns. */
const CALENDAR_MEETINGS_CAP = 1000;

@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly meetings?: MeetingsService,
    @Optional() private readonly addons?: AddonsService,
  ) {}

  async listEvents(
    scope: UserScope,
    from: Date,
    to: Date,
    types: CalendarEventType[],
    organizationId: string | null = null,
  ): Promise<{ items: CalendarEvent[] }> {
    const wantTasks = types.length === 0 || types.includes('task');
    const wantTodos = types.length === 0 || types.includes('todo');
    const wantTime = types.length === 0 || types.includes('time');
    const wantMeetings = types.length === 0 || types.includes('meeting');

    const events: CalendarEvent[] = [];

    if (wantTasks) {
      const projectOr: Prisma.TaskWhereInput[] = [];
      if (scope.workspaceIds.length > 0) {
        projectOr.push({ project: { workspaceId: { in: scope.workspaceIds } } });
      }
      if (scope.projectIds.length > 0) {
        projectOr.push({ projectId: { in: scope.projectIds } });
      }
      if (projectOr.length > 0) {
        // PRIVATE projects must not surface their tasks on the calendar of a
        // non-member - the calendar is one of the easiest places for a hidden
        // project to leak, since it aggregates across every project at once.
        const visibility = projectVisibilityWhere(scope);
        const tasks = await this.prisma.client.task.findMany({
          where: {
            deletedAt: null,
            ...(visibility ? { project: visibility as Prisma.ProjectWhereInput } : {}),
            OR: [
              {
                AND: [
                  { OR: projectOr },
                  {
                    OR: [
                      { dueDate: { gte: from, lte: to } },
                      { startDate: { gte: from, lte: to } },
                    ],
                  },
                ],
              },
            ],
          },
          include: {
            project: { select: { id: true, name: true, color: true } },
          },
          take: 1000,
        });
        for (const t of tasks) {
          const start = t.startDate ?? t.dueDate;
          if (!start) continue;
          events.push({
            id: `task:${t.id}`,
            type: 'task',
            title: t.title,
            start,
            end: t.dueDate ?? null,
            color: t.project?.color ?? null,
            projectId: t.project?.id ?? null,
            projectName: t.project?.name ?? null,
            meta: {
              taskId: t.id,
              status: t.status,
              priority: t.priority,
              assigneeId: t.assigneeId,
            },
          });
        }
      }
    }

    if (wantTodos && scope.currentWorkspaceId) {
      const todos = await this.prisma.client.todo.findMany({
        where: {
          userId: scope.userId,
          workspaceId: scope.currentWorkspaceId,
          deletedAt: null,
          dueDate: { gte: from, lte: to },
        },
        take: 500,
      });
      for (const t of todos) {
        if (!t.dueDate) continue;
        events.push({
          id: `todo:${t.id}`,
          type: 'todo',
          title: t.title,
          start: t.dueDate,
          end: null,
          color: null,
          projectId: null,
          projectName: null,
          meta: {
            todoId: t.id,
            priority: t.priority,
            done: t.done,
          },
        });
      }
    }

    if (wantTime && scope.currentWorkspaceId) {
      const entries = await this.prisma.client.timeEntry.findMany({
        where: {
          userId: scope.userId,
          workspaceId: scope.currentWorkspaceId,
          deletedAt: null,
          startTime: { gte: from, lte: to },
        },
        include: { project: { select: { id: true, name: true, color: true } } },
        take: 500,
      });
      for (const e of entries) {
        events.push({
          id: `time:${e.id}`,
          type: 'time',
          title: e.description ?? e.project?.name ?? 'Tracked time',
          start: e.startTime,
          end: e.endTime,
          color: e.project?.color ?? null,
          projectId: e.projectId,
          projectName: e.project?.name ?? null,
          meta: {
            timeEntryId: e.id,
            durationMin: e.durationMin,
            billable: e.billable,
          },
        });
      }
    }

    if (wantMeetings)
      events.push(...(await this.meetingEvents(scope.userId, organizationId, from, to)));

    events.sort((a, b) => a.start.getTime() - b.start.getTime());
    return { items: events };
  }

  /**
   * The caller's meeting occurrences, under the meetings visibility rule
   * (organizer and people added, own organization only). Never in a support
   * session (meetings are private), never when the add-on is off.
   */
  private async meetingEvents(
    userId: string,
    organizationId: string | null,
    from: Date,
    to: Date,
  ): Promise<CalendarEvent[]> {
    if (!this.meetings || !organizationId || isSupportRequest()) return [];
    if (this.addons && !(await this.addons.isEnabled(organizationId, 'meetings'))) return [];
    const maxTo = new Date(from.getTime() + MEETING_LIST_MAX_DAYS * 86_400_000);
    const { items } = await this.meetings.occurrences(
      { userId, organizationId },
      from,
      to.getTime() > maxTo.getTime() ? maxTo : to,
      { includeCancelled: false, limit: CALENDAR_MEETINGS_CAP },
    );
    return items.map((o) => ({
      id: `meeting:${o.meetingId}:${o.occurrenceStart.toISOString()}`,
      type: 'meeting' as const,
      title: o.title,
      start: o.startsAt,
      end: o.endsAt,
      color: o.color,
      projectId: null,
      projectName: null,
      meta: {
        meetingId: o.meetingId,
        occurrenceStart: o.occurrenceStart.toISOString(),
        allDay: o.allDay,
        timeZone: o.timeZone,
        status: o.status,
        location: o.location,
        meetingUrl: o.meetingUrl,
        isRecurring: o.isRecurring,
        isOrganizer: o.isOrganizer,
        myResponse: o.myResponse,
      },
    }));
  }
}
