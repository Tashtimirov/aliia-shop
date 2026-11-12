import { saveClient } from '@/lib/crm/actions';
import { CLIENT_SOURCES, SIZE_FIELDS } from '@/lib/crm/constants';
import type { ClientRow } from '@/lib/crm/data';
import { Field, Section, btnPrimaryCls, inputCls } from './ui';

export function ClientForm({ client, then }: { client?: ClientRow; then?: 'order' }) {
  const a = client?.delivery_address ?? {};
  const s = client?.sizes ?? {};
  return (
    <form action={saveClient} className="space-y-4">
      {client && <input type="hidden" name="client_id" value={client.id} />}
      {then && <input type="hidden" name="then" value={then} />}
      <Section title="Контакты">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Имя"><input name="name" defaultValue={client?.name ?? ''} className={inputCls} placeholder="Анна Петрова" /></Field>
          <Field label="Telegram"><input name="telegram_username" defaultValue={client?.telegram_username ? `@${client.telegram_username}` : ''} className={inputCls} placeholder="@username" /></Field>
          <Field label="Телефон"><input name="phone" type="tel" defaultValue={client?.phone ?? ''} className={inputCls} placeholder="+7 900 000-00-00" /></Field>
          <Field label="Instagram"><input name="instagram_username" defaultValue={client?.instagram_username ? `@${client.instagram_username}` : ''} className={inputCls} placeholder="@username" /></Field>
          <Field label="Город"><input name="city" defaultValue={client?.city ?? ''} className={inputCls} /></Field>
          <Field label="Откуда пришёл">
            <select name="source" defaultValue={client?.source ?? 'manual'} className={inputCls}>
              {Object.entries(CLIENT_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
      </Section>
      <Section title="Размеры">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SIZE_FIELDS.map(([k, label]) => (
            <Field key={k} label={label}><input name={`size_${k}`} defaultValue={s[k] ?? ''} className={inputCls} /></Field>
          ))}
        </div>
      </Section>
      <Section title="Доставка">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Получатель"><input name="addr_recipient" defaultValue={a.recipient_name ?? ''} className={inputCls} /></Field>
          <Field label="Телефон получателя"><input name="addr_phone" defaultValue={a.recipient_phone ?? ''} className={inputCls} /></Field>
          <Field label="Город доставки"><input name="addr_city" defaultValue={a.city ?? ''} className={inputCls} /></Field>
          <Field label="Код ПВЗ СДЭК"><input name="addr_pvz" defaultValue={a.pvz_code ?? ''} className={inputCls} placeholder="MSK123" /></Field>
        </div>
        <Field label="Адрес"><input name="addr_address" defaultValue={a.address ?? ''} className={inputCls} /></Field>
      </Section>
      <Section title="Заметки">
        <textarea name="notes" rows={3} defaultValue={client?.notes ?? ''} className={inputCls} placeholder="Посадка, любимые вещи, договорённости" />
      </Section>
      <button className={btnPrimaryCls}>{client ? 'Сохранить клиента' : then === 'order' ? 'Создать и перейти к заказу' : 'Создать клиента'}</button>
    </form>
  );
}
