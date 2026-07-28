import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { BackupController } from './backup.controller';

@Module({ controllers: [SettingsController, BackupController] })
export class SettingsModule {}
