/**
 * Estrutura rica do handoff interno (briefing de projeto — PJ Codeworks).
 * Campos opcionais costumam ser preenchidos com "não informado" na saída operacional.
 */
export type LeadTemperature = "frio" | "morno" | "quente";

export type CommercialPlan = "iniciante" | "padrao" | "premium" | "personalizado";

export type AiImageAspect = "16:9" | "4:3" | "1:1" | "9:16";

export type AiImageStatus = "pending" | "generated" | "failed";

export type AiImageHandoffType = "hero" | "wireframe" | "site_preview";

export type SiteStructureSuggestion = {
  hero?: string;
  sobre?: string;
  servicos?: string;
  diferenciais?: string;
  areaAtendimento?: string;
  provaSocial?: string;
  chamadaWhatsapp?: string;
  faq?: string;
  ctaFinal?: string;
};

export type InitialSiteContent = {
  headline?: string;
  subtitle?: string;
  apresentacao?: string;
  servicos?: string[];
  ctas?: string[];
  faq?: { pergunta?: string; resposta?: string }[];
};

export type ProjectHandoff = {
  lead: {
    name?: string;
    phone: string;
    email?: string;
    niche: string;
    businessType?: string;
    city?: string;
    state?: string;
    temperature?: LeadTemperature;
    painScore?: number;
    complexity?: string;
  };

  commercial: {
    reason: string;
    plan: CommercialPlan;
    totalPrice?: number;
    entryPrice?: number;
    installments?: {
      quantity: number;
      value: number;
    };
    monthlyFee?: number;
    monthlyStartsAfter?: string;
    freeDays?: number;
    roi?: number;
    objections?: string[];
    sellingPoints?: string[];
  };

  meeting: {
    /** Resumo textual enviado pela IA em `resumo_handoff` (uso interno). */
    reunionSummary?: string;
    date?: string;
    time?: string;
    durationMinutes?: number;
    goal?: string;
    suggestedOpening?: string;
    recommendedTone?: string;
    reinforce?: string[];
    avoid?: string[];
    nextSteps?: string[];
    checklistPosFechamento?: string[];
  };

  briefing: {
    projectGoal?: string;
    targetAudience?: string;
    mainServices?: string[];
    serviceRegion?: string;
    differentiators?: string[];
    competitors?: string[];
    mainPain?: string;
    sitePromise?: string;
    requiredCtas?: string[];
    integrations?: string[];
    importantLinks?: {
      instagram?: string;
      whatsapp?: string;
      googleBusiness?: string;
      website?: string;
    };
    /** Resumo da coleta (aparece no Google?). */
    googlePresenceNote?: string;
    recommendedSections?: string[];
  };

  siteStructure?: SiteStructureSuggestion;

  seoLocal: {
    mainKeyword?: string;
    secondaryKeywords?: string[];
    city?: string;
    regions?: string[];
    suggestedTitle?: string;
    suggestedMetaDescription?: string;
  };

  initialContent?: InitialSiteContent;

  aiImage: {
    /** Compat: prompt antigo de hero/foto; mantido no DOCX como referência opcional. */
    heroPrompt?: string;
    /** Prompt usado na prévia visual “site pronto” do handoff interno. */
    sitePreviewPrompt?: string;
    /** Opcional: mesmo texto que `sitePreviewPrompt` (atalho para leitores do payload). */
    prompt?: string;
    supportPrompt?: string;
    style?: string;
    aspectRatio?: AiImageAspect;
    brandingNotes?: string;
    type?: AiImageHandoffType;
    status?: AiImageStatus;
    imageUrl?: string;
    imagePath?: string;
    error?: string;
  };

  generatedFiles: {
    briefingDocxUrl?: string;
    briefingDocxPath?: string;
    /** @deprecated usar briefingSitePreviewImagePath */
    briefingHeroImagePath?: string;
    briefingSitePreviewImagePath?: string;
    generatedAt?: string;
  };

  /** Pacote JSON serializável para auditoria (opcional). */
  rawDigest?: string;
};
