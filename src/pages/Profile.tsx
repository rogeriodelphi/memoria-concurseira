import { useState, type FormEvent } from 'react';

import { PasswordInput } from '../components/PasswordInput';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { ApiError, authApi } from '../services/api';
import { getInitials } from '../utils/initials';

export function Profile() {
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  if (!user) return null;

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setProfileError(null);
    try {
      const { user: updated } = await authApi.updateProfile(name, email);
      updateUser(updated);
      showToast('Perfil atualizado com sucesso!');
    } catch (err) {
      setProfileError(err instanceof ApiError ? err.message : 'Não foi possível salvar o perfil.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      setPasswordError('A nova senha precisa ter ao menos 8 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('A confirmação não coincide com a nova senha.');
      return;
    }
    setSavingPassword(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast('Senha alterada com sucesso!');
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Não foi possível alterar a senha.');
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Meu perfil</h1>
      <p className="mb-8 text-sm text-neutral-500 dark:text-neutral-400">
        Gerencie seus dados e sua senha de acesso.
      </p>

      <div className="card mb-6 p-6">
        <div className="mb-6 flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">
            {getInitials(user.name)}
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-neutral-900 dark:text-neutral-100">{user.name}</p>
            <p className="text-xs text-neutral-400 dark:text-neutral-500">
              Membro desde {new Date(user.createdAt).toLocaleDateString('pt-BR')}
            </p>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div>
            <label className="label-field">Nome</label>
            <input
              type="text"
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label-field">E-mail</label>
            <input
              type="email"
              className="input-field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          {profileError && <p className="text-sm text-red-600">{profileError}</p>}
          <button type="submit" disabled={savingProfile} className="btn-primary">
            {savingProfile ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </form>
      </div>

      <div className="card p-6">
        <h2 className="mb-4 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Alterar senha</h2>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label className="label-field">Senha atual</label>
            <PasswordInput
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label-field">Nova senha</label>
            <PasswordInput
              placeholder="Mínimo de 8 caracteres"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="label-field">Confirmar nova senha</label>
            <PasswordInput
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          <button type="submit" disabled={savingPassword} className="btn-primary">
            {savingPassword ? 'Alterando...' : 'Alterar senha'}
          </button>
        </form>
      </div>
    </div>
  );
}
