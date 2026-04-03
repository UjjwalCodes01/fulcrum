import { Router, IRouter } from 'express';

export const auditRouter: IRouter = Router();

// Placeholder - will be implemented in Phase 4
auditRouter.get('/', (_req, res) => {
  res.json({
    logs: [],
    total: 0,
    page: 1,
    limit: 50,
    message: 'Audit endpoint placeholder',
    phase: 'Phase 4: LangGraph + Gemini Agent',
  });
});

auditRouter.get('/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  
  res.json({
    sessionId,
    logs: [],
    message: 'Audit endpoint placeholder',
    phase: 'Phase 4: LangGraph + Gemini Agent',
  });
});
