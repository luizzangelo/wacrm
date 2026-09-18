'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Upload, Trash2, CircleAlert } from 'lucide-react';
import { EMAIL_SUPPORT_MESSAGE } from '@/lib/auth/policy';

import { createClient } from '@/lib/supabase/client';
import { privateObjectUrl } from '@/lib/storage/private-reference';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { useTranslations } from 'next-intl';
import { SettingsPanelHead } from './settings-panel-head';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export function ProfileForm() {
  const t = useTranslations('Settings.profile');
  const { user, profile, refreshProfile } = useAuth();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState('');
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  // Seed form state once the profile loads.
  useEffect(() => {
    if (!profile) return;
    setFullName(profile.full_name ?? '');
  }, [profile]);

  // Cleanup object URLs to avoid leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const currentAvatar =
    previewUrl ?? (!removeAvatar ? (profile?.avatar_url ?? null) : null);

  const initial = (fullName || profile?.full_name || profile?.email || 'U')
    .charAt(0)
    .toUpperCase();

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // reset so the same file can be re-picked
    if (!file) return;

    if (!ALLOWED_MIME.has(file.type)) {
      toast.error(t('unsupportedImage'), {
        description: t('unsupportedImageDesc'),
      });
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(t('imageTooLarge'), {
        description: t('imageTooLargeDesc'),
      });
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(file);
    setPreviewUrl(URL.createObjectURL(file));
    setRemoveAvatar(false);
  };

  const onRemoveAvatar = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPendingAvatar(null);
    setPreviewUrl(null);
    setRemoveAvatar(true);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !profile) return;

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      toast.error(t('nameRequired'));
      return;
    }

    setSaving(true);
    try {
      let nextAvatarUrl: string | null = profile.avatar_url ?? null;

      // Upload a newly-staged image, if any.
      if (pendingAvatar) {
        const ext = pendingAvatar.name.split('.').pop()?.toLowerCase() || 'png';
        const path = `${user.id}/avatar-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(path, pendingAvatar, {
            cacheControl: '3600',
            upsert: true,
            contentType: pendingAvatar.type,
          });
        if (uploadError) {
          throw new Error(t('uploadFailed', { message: uploadError.message }));
        }
        nextAvatarUrl = privateObjectUrl('avatars', path);
      } else if (removeAvatar) {
        nextAvatarUrl = null;
      }

      // Persist name + avatar to profiles.
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: trimmedName,
          avatar_url: nextAvatarUrl,
        })
        .eq('user_id', user.id);
      if (updateError) {
        throw new Error(t('saveFailed', { message: updateError.message }));
      }

      setPendingAvatar(null);
      setPreviewUrl(null);
      setRemoveAvatar(false);
      await refreshProfile();

      toast.success(t('profileSaved'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const dirty =
    !!profile &&
    (fullName.trim() !== (profile.full_name ?? '') ||
      pendingAvatar !== null ||
      removeAvatar);

  const joined = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : '—';

  return (
    <section className="animate-in fade-in-50 max-w-2xl duration-200">
      <SettingsPanelHead title={t('title')} description={t('description')} />
      <form onSubmit={onSubmit} className="space-y-4">
        <Card>
          <CardContent className="space-y-6">
            {/* Avatar row */}
            <div className="flex flex-wrap items-center gap-5">
              <Avatar size="lg" className="size-16">
                {currentAvatar ? (
                  <AvatarImage src={currentAvatar} alt={fullName || 'Avatar'} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary text-base">
                  {initial}
                </AvatarFallback>
              </Avatar>

              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={onPickFile}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                >
                  <Upload className="size-4" />
                  {currentAvatar ? t('changePhoto') : t('uploadPhoto')}
                </Button>
                {currentAvatar && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={onRemoveAvatar}
                    disabled={saving}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <Trash2 className="size-4" />
                    {t('remove')}
                  </Button>
                )}
                <p className="text-muted-foreground w-full text-xs">
                  {t('photoHint')}
                </p>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="profile-full-name" className="text-foreground">
                {t('displayName')}
              </Label>
              <Input
                id="profile-full-name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Ada Lovelace"
                maxLength={120}
                disabled={saving}
                required
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="profile-email" className="text-foreground">
                {t('email')}
              </Label>
              <Input
                id="profile-email"
                type="email"
                value={user?.email ?? profile?.email ?? ''}
                readOnly
                aria-describedby="profile-email-support"
              />
              <p
                id="profile-email-support"
                className="text-muted-foreground text-xs"
              >
                {EMAIL_SUPPORT_MESSAGE}
              </p>
            </div>

            {/* Read-only block */}
            <div className="border-border bg-muted rounded-lg border p-4">
              <p className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
                {t('accountDetails')}
              </p>
              <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t('role')}</dt>
                  <dd className="text-foreground mt-0.5 font-mono">
                    {profile?.role ?? 'user'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('joined')}</dt>
                  <dd className="text-foreground mt-0.5">{joined}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-muted-foreground">{t('userId')}</dt>
                  <dd className="text-muted-foreground mt-0.5 font-mono text-xs break-all">
                    {user?.id ?? '—'}
                  </dd>
                </div>
              </dl>
            </div>

            {!profile && (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <CircleAlert className="size-4" />
                {t('loading')}
              </p>
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !dirty || !profile}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t('saving')}
              </>
            ) : (
              t('saveChanges')
            )}
          </Button>
        </div>
      </form>
    </section>
  );
}
