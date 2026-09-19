import { Router } from 'express';
import { authenticateToken } from '../middleware/auth.middleware';
import { 
  getTeams, 
  createTeam, 
  updateTeam, 
  deleteTeam,
  createTeamRole,
  updateTeamRole,
  deleteTeamRole
} from '../controllers/team.controller';

const router = Router();

router.use(authenticateToken);

router.get('/', getTeams);
router.post('/', createTeam);
router.patch('/:id', updateTeam);
router.delete('/:id', deleteTeam);

router.post('/:teamId/roles', createTeamRole);
router.patch('/:teamId/roles/:roleId', updateTeamRole);
router.delete('/:teamId/roles/:roleId', deleteTeamRole);

export default router;
