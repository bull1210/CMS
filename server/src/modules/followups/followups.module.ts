import { Module } from '@nestjs/common';
import { FollowupsController } from './followups.controller';

@Module({ controllers: [FollowupsController] })
export class FollowupsModule {}
