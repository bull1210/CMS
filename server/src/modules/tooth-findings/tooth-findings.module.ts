import { Module } from '@nestjs/common';
import { ToothFindingsController } from './tooth-findings.controller';

@Module({ controllers: [ToothFindingsController] })
export class ToothFindingsModule {}
