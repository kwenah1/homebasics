import { useAuth } from '../../auth/AuthContext'
import { AddressBook } from './AddressBook'
import { PasswordForm } from './PasswordForm'
import { ProfileForm } from './ProfileForm'

export function Section({ title, children, id }: { title: string; children: React.ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-stone-200 bg-white p-6">
      <h2 id={id} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function AccountPage() {
  const { user } = useAuth()
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="account-heading">
          Hi, {user?.first_name}
        </h1>
        <p className="text-sm text-stone-600" data-testid="account-email">
          {user?.email}
        </p>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Section title="Profile" id="profile-heading">
          <ProfileForm />
        </Section>
        <Section title="Change password" id="password-heading">
          <PasswordForm />
        </Section>
      </div>
      <Section title="Address book" id="addresses-heading">
        <AddressBook />
      </Section>
    </div>
  )
}
