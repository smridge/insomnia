import { createBuilder } from '@develohpanda/fluent-builder';
import { mocked } from 'ts-jest/utils';

import { globalBeforeEach } from '../../../__jest__/before-each';
import { DEFAULT_BRANCH_NAME } from '../../../common/constants';
import * as models from '../../../models';
import { isRemoteSpace } from '../../../models/space';
import { Workspace } from '../../../models/workspace';
import { projectWithTeamSchema } from '../../__schemas__/type-schemas';
import MemoryDriver from '../../store/drivers/memory-driver';
import { pullProject } from '../pull-project';
import { VCS } from '../vcs';

jest.mock('../vcs');

const project = createBuilder(projectWithTeamSchema).build();

const newMockedVcs = () => mocked(new VCS(new MemoryDriver()), true);

describe('pullProject()', () => {
  let vcs = newMockedVcs();

  beforeEach(async () => {
    (VCS as jest.MockedClass<typeof VCS>).mockClear();
    await globalBeforeEach();
    vcs = newMockedVcs();
  });

  afterEach(() => {
    expect(vcs.setProject).toHaveBeenCalledWith(project);
    expect(vcs.checkout).toHaveBeenCalledWith([], DEFAULT_BRANCH_NAME);
  });

  describe('creating a new project', () => {
    beforeEach(() => {
      vcs.getRemoteBranches.mockResolvedValue([]);
    });

    afterEach(() => {
      expect(vcs.pull).not.toHaveBeenCalledWith([], expect.anything());
    });

    it('should use existing space', async () => {
      // Arrange
      const space = await models.space.create({
        name: `${project.team.name} unique`, 
        remoteId: project.team.id, 
      });

      // Act
      await pullProject({ vcs, project, remoteSpaces: [space].filter(isRemoteSpace) });

      // Assert
      expect(space?.name).not.toBe(project.team.name); // should not rename if the space already exists
      
      const workspaces = await models.workspace.all();
      expect(workspaces).toHaveLength(1);
      const workspace = workspaces[0];
      expect(workspace).toStrictEqual(expect.objectContaining<Partial<Workspace>>({
        _id: project.rootDocumentId,
        name: project.name,
        parentId: space._id,
        scope: 'collection',
      }));
    });

    it('should insert a space and workspace with parent', async () => {
      // Act
      await pullProject({ vcs, project, remoteSpaces: [] });

      // Assert
      const space = await models.space.getByRemoteId(project.team.id);
      expect(space?.name).toBe(project.team.name);
      
      const workspaces = await models.workspace.all();
      expect(workspaces).toHaveLength(1);
      const workspace = workspaces[0];
      expect(workspace).toStrictEqual(expect.objectContaining<Partial<Workspace>>({
        _id: project.rootDocumentId,
        name: project.name,
        parentId: space?._id,
        scope: 'collection',
      }));
    });

    it('should update a workspace if the name or parentId is different', async () => {
      // Arrange
      await models.workspace.create({ _id: project.rootDocumentId, name: 'someName' });

      // Act
      await pullProject({ vcs, project, remoteSpaces: [] });

      // Assert
      const space = await models.space.getByRemoteId(project.team.id);

      const workspaces = await models.workspace.all();
      expect(workspaces).toHaveLength(1);
      const workspace = workspaces[0];
      expect(workspace).toStrictEqual(expect.objectContaining<Partial<Workspace>>({
        _id: project.rootDocumentId,
        name: project.name,
        parentId: space?._id,
      }));
    });
  });

  describe('pulling an existing project', () => {
    beforeEach(() => {
      vcs.getRemoteBranches.mockResolvedValue([DEFAULT_BRANCH_NAME]);
    });

    afterEach(() => {
    });

    it('should overwrite the parentId only for a workspace with the space id', async () => {
      // Arrange
      const existingWrk = await models.workspace.create({ _id: project.rootDocumentId, name: project.name });
      const existingReq = await models.request.create({ parentId: existingWrk._id });

      vcs.allDocuments.mockResolvedValue([existingWrk, existingReq]);

      // Act
      await pullProject({ vcs, project, remoteSpaces: [] });

      // Assert
      const space = await models.space.getByRemoteId(project.team.id);

      const workspaces = await models.workspace.all();
      expect(workspaces).toHaveLength(1);
      const workspace = workspaces[0];
      expect(workspace).toStrictEqual(expect.objectContaining<Partial<Workspace>>({
        _id: project.rootDocumentId,
        name: project.name,
        parentId: space?._id,
      }));

      const requests = await models.request.all();
      expect(requests).toHaveLength(1);
      const request = requests[0];
      expect(request).toStrictEqual(existingReq);

      expect(vcs.pull).toHaveBeenCalledWith([], space?.remoteId);
    });
  });
});
