import { Module } from '@nestjs/common';
import { DiagnosesController } from './diagnoses.controller';

@Module({ controllers: [DiagnosesController] })
export class DiagnosesModule {}
