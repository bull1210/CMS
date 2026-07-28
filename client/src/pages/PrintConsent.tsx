import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { Button, Spinner } from '../components/ui';
import { Patient } from './Patients';

const TEMPLATES: Record<string, { title: string; intro: string; risks: string[] }> = {
  general: {
    title: 'Consent for Dental Treatment',
    intro:
      'I authorize the doctor and clinical staff to perform the dental examination, diagnostic procedures (including X-rays), and the treatment explained to me.',
    risks: [
      'Discomfort, swelling or sensitivity after treatment',
      'Reaction to local anaesthesia',
      'The possibility that the planned treatment may need to change based on clinical findings',
    ],
  },
  extraction: {
    title: 'Consent for Tooth Extraction',
    intro:
      'The reasons for removing the tooth/teeth, and alternatives (root canal treatment, no treatment), have been explained to me. I consent to the extraction under local anaesthesia.',
    risks: [
      'Pain, swelling and bruising for a few days',
      'Bleeding that may need additional care',
      'Dry socket (delayed healing of the extraction site)',
      'Numbness of lip, chin or tongue, usually temporary, rarely persistent',
      'Sinus involvement for upper back teeth',
      'The need for a follow-up visit or further procedures',
    ],
  },
  'root-canal': {
    title: 'Consent for Root Canal Treatment',
    intro:
      'The purpose of root canal treatment — removing infected pulp to save the tooth — and its alternatives (extraction, no treatment) have been explained to me. I understand it is usually completed over multiple visits and the tooth may need a crown afterwards.',
    risks: [
      'Discomfort or flare-up between visits',
      'Instrument separation or blocked canals that may need referral',
      'The tooth may become brittle and require a crown',
      'A small percentage of treatments fail and may need re-treatment or extraction',
    ],
  },
  implant: {
    title: 'Consent for Dental Implant',
    intro:
      'The implant procedure — surgical placement of a titanium fixture followed by a prosthetic crown — its timeline, and alternatives (bridge, denture, no treatment) have been explained to me.',
    risks: [
      'Surgical risks: pain, swelling, bleeding, infection',
      'Failure of the implant to integrate with bone (may need removal/redo)',
      'Nerve or sinus involvement depending on the site',
      'The need for bone grafting in some cases',
      'Long-term maintenance requirements (hygiene, reviews)',
    ],
  },
};

export default function PrintConsent() {
  const { patientId, type } = useParams();
  const template = TEMPLATES[type ?? 'general'] ?? TEMPLATES.general;
  const { data: patient, isLoading } = useQuery<Patient>({
    queryKey: ['patient', Number(patientId)],
    queryFn: () => api(`/patients/${patientId}`),
  });
  const { data: settings } = useQuery<Record<string, string>>({ queryKey: ['settings'], queryFn: () => api('/settings') });

  if (isLoading || !patient) return <Spinner />;

  const age = patient.dob
    ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / (365.25 * 86400_000))
    : null;

  return (
    <div className="max-w-2xl mx-auto p-8 bg-white min-h-screen">
      <div className="no-print flex justify-between mb-6">
        <Link to={`/patients/${patient.id}`} className="text-sm text-indigo-600 hover:underline">← Back to patient</Link>
        <Button onClick={() => window.print()}>Print / Save PDF</Button>
      </div>

      <div className="border-b-2 border-slate-800 pb-4 mb-6">
        <h1 className="text-2xl font-bold text-slate-800">{settings?.['clinic.name'] ?? 'Clinic'}</h1>
        <p className="text-sm text-slate-500">{settings?.['clinic.address']} · {settings?.['clinic.phone']}</p>
      </div>

      <h2 className="text-lg font-bold text-slate-800 mb-4">{template.title}</h2>

      <div className="text-sm text-slate-700 space-y-1 mb-6">
        <p><b>Patient:</b> {patient.name} ({patient.code}){age !== null ? `, ${age} yrs` : ''}</p>
        <p><b>Phone:</b> {patient.phone}</p>
        <p><b>Date:</b> {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <p><b>Tooth / procedure details:</b> ________________________________________________</p>
      </div>

      <p className="text-sm text-slate-700 leading-relaxed mb-4">{template.intro}</p>

      <p className="text-sm text-slate-700 mb-2">I understand the possible risks and complications, including but not limited to:</p>
      <ul className="list-disc pl-6 text-sm text-slate-700 space-y-1 mb-6">
        {template.risks.map((r) => <li key={r}>{r}</li>)}
      </ul>

      <p className="text-sm text-slate-700 leading-relaxed mb-2">
        I have had the opportunity to ask questions, and all my questions have been answered to my satisfaction.
        I confirm that the medical history I have provided is complete and accurate.
      </p>
      <p className="text-sm text-slate-700 leading-relaxed">
        I, <b>{patient.name}</b>, hereby give my informed consent for the procedure described above to be performed
        by {settings?.['clinic.doctor'] ?? 'the doctor'} and team.
      </p>

      <div className="grid grid-cols-2 gap-12 mt-20 text-sm text-slate-600">
        <div className="border-t border-slate-400 pt-2">
          Patient / guardian signature
          <div className="text-xs text-slate-400 mt-1">Date: ____________</div>
        </div>
        <div className="border-t border-slate-400 pt-2">
          {settings?.['clinic.doctor'] ?? 'Doctor'}
          <div className="text-xs text-slate-400 mt-1">Signature & seal</div>
        </div>
      </div>
    </div>
  );
}
