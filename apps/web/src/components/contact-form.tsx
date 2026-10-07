"use client";

import { FormEvent, useState } from "react";
import { UiIcon } from "@/components/ui-icon";

export function ContactForm() {
  const [sent, setSent] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSent(true); }
  return <form className="contact-form" onSubmit={submit}>
    <div className="contact-form-heading"><span>FORMULARIO DE CONTACTO</span><h2>Cuéntanos sobre tu organización</h2><p>Completa los datos y te mostraremos una confirmación de demostración.</p></div>
    <div className="contact-form-grid"><label>Nombre completo<input name="name" autoComplete="name" placeholder="Tu nombre" required /></label><label>Correo electrónico<input name="email" type="email" autoComplete="email" placeholder="tu@empresa.com" required /></label><label>Organización<input name="organization" autoComplete="organization" placeholder="Nombre de tu organización" required /></label><label>Servicio de interés<select name="service" defaultValue=""><option value="" disabled>Selecciona una opción</option><option>Cloud</option><option>Servidor local</option><option>Modelo híbrido</option><option>Quiero recibir orientación</option></select></label><label className="contact-message-field">¿Cómo podemos ayudarte?<textarea name="message" rows={4} placeholder="Describe brevemente lo que necesitas" required /></label></div>
    <button className="button public-button-purple" type="submit">Enviar solicitud <UiIcon name="arrowRight" size={14} /></button>
    {sent && <div className="contact-success" role="status"><b>Solicitud registrada en esta demostración.</b><span>Tus datos no se enviaron ni guardaron; el formulario aún no está conectado a un servicio de contacto.</span></div>}
    <p className="contact-form-note">Formulario de demostración. Al no existir un servicio conectado, la solicitud no se envía.</p>
  </form>;
}
