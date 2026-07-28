import { Module } from '@nestjs/common';
import { LabworksController } from './labworks.controller';

@Module({ controllers: [LabworksController] })
export class LabworksModule {}
