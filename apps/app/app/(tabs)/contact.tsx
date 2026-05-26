import React, { useCallback, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/src/components/ui/Icon';
import { PROFILE_TAB_BAR_SPACER } from '@/src/components/navigation/tabBarMetrics';
import { useLanguage, type LanguageCode } from '@/src/i18n';
import { api } from '@/src/utils/api';

type FormStatus =
  | { type: 'idle' }
  | { type: 'success'; message: string }
  | { type: 'error'; message: string };

type ContactResponse = {
  message?: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COPY: Record<
  LanguageCode,
  {
    title: string;
    backToSettings: string;
    lead: string;
    general: string;
    support: string;
    name: string;
    namePlaceholder: string;
    email: string;
    subject: string;
    subjectPlaceholder: string;
    message: string;
    messagePlaceholder: string;
    optional: string;
    send: string;
    sending: string;
    missingRequired: string;
    invalidEmail: string;
    shortMessage: string;
    success: string;
    failure: string;
  }
> = {
  en: {
    title: 'Contact',
    backToSettings: 'Back to settings',
    lead: 'Need help with HuisHype, your account, property activity, listing source links, comments, guesses, saves, or privacy questions? Send us a message and we will route it to the right inbox.',
    general: 'General',
    support: 'Support',
    name: 'Name',
    namePlaceholder: 'Your name',
    email: 'Email',
    subject: 'Subject',
    subjectPlaceholder: 'What is this about?',
    message: 'Message',
    messagePlaceholder: 'How can we help?',
    optional: 'optional',
    send: 'Send message',
    sending: 'Sending...',
    missingRequired: 'Enter your name, email address, and message before sending.',
    invalidEmail: 'Enter a valid email address.',
    shortMessage: 'Enter a message with at least 10 characters.',
    success: 'Thanks. We received your message.',
    failure: 'We could not send your message. Please try again or email support@huishype.nl.',
  },
  nl: {
    title: 'Contact',
    backToSettings: 'Terug naar instellingen',
    lead: 'Hulp nodig met HuisHype, je account, woningactiviteit, advertentielinks, reacties, schattingen, opgeslagen woningen of privacyvragen? Stuur ons een bericht en wij sturen het naar de juiste inbox.',
    general: 'Algemeen',
    support: 'Support',
    name: 'Naam',
    namePlaceholder: 'Je naam',
    email: 'E-mail',
    subject: 'Onderwerp',
    subjectPlaceholder: 'Waar gaat dit over?',
    message: 'Bericht',
    messagePlaceholder: 'Waarmee kunnen we helpen?',
    optional: 'optioneel',
    send: 'Bericht sturen',
    sending: 'Versturen...',
    missingRequired: 'Vul je naam, e-mailadres en bericht in voordat je verzendt.',
    invalidEmail: 'Vul een geldig e-mailadres in.',
    shortMessage: 'Vul een bericht in van minstens 10 tekens.',
    success: 'Bedankt. We hebben je bericht ontvangen.',
    failure:
      'We konden je bericht niet verzenden. Probeer het opnieuw of mail support@huishype.nl.',
  },
};

export default function ContactScreen() {
  const { language } = useLanguage();
  const copy = COPY[language];
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<FormStatus>({ type: 'idle' });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canSubmit = useMemo(
    () =>
      !isSubmitting &&
      name.trim().length > 0 &&
      email.trim().length > 0 &&
      message.trim().length >= 10,
    [email, isSubmitting, message, name]
  );

  const handleBack = useCallback(() => {
    router.replace('/settings');
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedSubject = subject.trim();
    const trimmedMessage = message.trim();

    if (!trimmedName || !trimmedEmail || !trimmedMessage) {
      setStatus({
        type: 'error',
        message: copy.missingRequired,
      });
      return;
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setStatus({
        type: 'error',
        message: copy.invalidEmail,
      });
      return;
    }

    if (trimmedMessage.length < 10) {
      setStatus({
        type: 'error',
        message: copy.shortMessage,
      });
      return;
    }

    setIsSubmitting(true);
    setStatus({ type: 'idle' });

    try {
      const response = await api.post<ContactResponse>('/contact', {
        name: trimmedName,
        email: trimmedEmail,
        ...(trimmedSubject ? { subject: trimmedSubject } : {}),
        message: trimmedMessage,
      });

      setStatus({
        type: 'success',
        message: language === 'en' && response.message ? response.message : copy.success,
      });
      setName('');
      setEmail('');
      setSubject('');
      setMessage('');
    } catch {
      setStatus({
        type: 'error',
        message: copy.failure,
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [copy, email, language, message, name, subject]);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { paddingTop: Platform.OS === 'web' ? 16 : insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="contact-screen"
    >
      <View style={styles.header}>
        <Pressable
          onPress={handleBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={copy.backToSettings}
          style={styles.headerButton}
          testID="contact-page-back"
        >
          <Icon name="ArrowLeft" size="lg" color="#003C32" />
        </Pressable>
        <Text style={styles.headerTitle} accessibilityRole="header">
          {copy.title}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, { paddingBottom: PROFILE_TAB_BAR_SPACER + 32 }]}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
      >
        <Text style={styles.lead}>{copy.lead}</Text>

        <View style={styles.emailBlock}>
          <Text style={styles.emailLine}>{copy.general}: contact@huishype.nl</Text>
          <Text style={styles.emailLine}>{copy.support}: support@huishype.nl</Text>
        </View>

        <View style={styles.form}>
          <FieldLabel label={copy.name} />
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.input}
            placeholder={copy.namePlaceholder}
            placeholderTextColor="#8B8580"
            accessibilityLabel={copy.name}
            autoCapitalize="words"
            textContentType="name"
            testID="contact-name-input"
          />

          <FieldLabel label={copy.email} />
          <TextInput
            value={email}
            onChangeText={setEmail}
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor="#8B8580"
            accessibilityLabel={copy.email}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
            testID="contact-email-input"
          />

          <FieldLabel label={copy.subject} optionalLabel={copy.optional} />
          <TextInput
            value={subject}
            onChangeText={setSubject}
            style={styles.input}
            placeholder={copy.subjectPlaceholder}
            placeholderTextColor="#8B8580"
            accessibilityLabel={copy.subject}
            autoCapitalize="sentences"
            testID="contact-subject-input"
          />

          <FieldLabel label={copy.message} />
          <TextInput
            value={message}
            onChangeText={setMessage}
            style={[styles.input, styles.messageInput]}
            placeholder={copy.messagePlaceholder}
            placeholderTextColor="#8B8580"
            accessibilityLabel={copy.message}
            multiline
            textAlignVertical="top"
            testID="contact-message-input"
          />

          {status.type !== 'idle' ? (
            <Text
              style={[
                styles.statusText,
                status.type === 'success' ? styles.statusSuccess : styles.statusError,
              ]}
              accessibilityRole="alert"
              testID={`contact-${status.type}-message`}
            >
              {status.message}
            </Text>
          ) : null}

          <Pressable
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
            style={({ pressed }) => [
              styles.submitButton,
              !canSubmit && styles.submitButtonDisabled,
              pressed && canSubmit && styles.submitButtonPressed,
            ]}
            testID="contact-submit-button"
          >
            <Icon name="PaperPlaneTilt" size="md" color="#FFFFFF" />
            <Text style={styles.submitButtonText}>{isSubmitting ? copy.sending : copy.send}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FieldLabel({ label, optionalLabel }: { label: string; optionalLabel?: string }) {
  return (
    <Text style={styles.label}>
      {label}
      {optionalLabel ? <Text style={styles.optional}> {optionalLabel}</Text> : null}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#ECECEC',
    paddingHorizontal: 18,
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    color: '#003C32',
  },
  scroll: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 28,
  },
  lead: {
    fontSize: 19,
    lineHeight: 29,
    color: '#003C32',
    fontWeight: '500',
    marginBottom: 18,
  },
  emailBlock: {
    borderWidth: 1,
    borderColor: '#ECECEC',
    borderRadius: 8,
    padding: 16,
    marginBottom: 26,
    backgroundColor: '#FCFAF7',
  },
  emailLine: {
    fontSize: 16,
    lineHeight: 24,
    color: '#2D2926',
  },
  form: {
    gap: 10,
  },
  label: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '700',
    color: '#003C32',
    marginTop: 8,
  },
  optional: {
    color: '#6E6A65',
    fontWeight: '500',
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: '#DCD8D2',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    lineHeight: 22,
    color: '#2D2926',
    backgroundColor: '#FFFFFF',
  },
  messageInput: {
    minHeight: 138,
  },
  statusText: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  statusSuccess: {
    color: '#156C45',
  },
  statusError: {
    color: '#B3261E',
  },
  submitButton: {
    minHeight: 54,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#003C32',
    marginTop: 12,
  },
  submitButtonDisabled: {
    backgroundColor: '#A8B5B0',
  },
  submitButtonPressed: {
    opacity: 0.88,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
  },
});
