import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { CoreModule } from './core/core.module';
import { AuthGuard } from './core/auth.guard';
import { PrismaExceptionFilter } from './core/prisma-exception.filter';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { PatientsModule } from './modules/patients/patients.module';
import { ProceduresModule } from './modules/procedures/procedures.module';
import { DiagnosesModule } from './modules/diagnoses/diagnoses.module';
import { TreatmentsModule } from './modules/treatments/treatments.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { BillingModule } from './modules/billing/billing.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { FollowupsModule } from './modules/followups/followups.module';
import { MessagingModule } from './modules/messaging/messaging.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';
import { SettingsModule } from './modules/settings/settings.module';
import { ToothFindingsModule } from './modules/tooth-findings/tooth-findings.module';
import { PlansModule } from './modules/plans/plans.module';
import { LabworksModule } from './modules/labworks/labworks.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { FilesModule } from './modules/files/files.module';
import { PlatformModule } from './modules/platform/platform.module';

@Module({
  imports: [
    CoreModule,
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '12h' }, // session timeout
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    PatientsModule,
    ProceduresModule,
    DiagnosesModule,
    TreatmentsModule,
    AppointmentsModule,
    BillingModule,
    DocumentsModule,
    PrescriptionsModule,
    FollowupsModule,
    MessagingModule,
    DashboardModule,
    ReportsModule,
    SearchModule,
    SettingsModule,
    ToothFindingsModule,
    PlansModule,
    LabworksModule,
    InventoryModule,
    ExpensesModule,
    FilesModule,
    PlatformModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
