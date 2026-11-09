import { Destination } from '../files/entities/destination.entity';
import { DeploymentModel } from '../iam/domain/enums';
import { STORAGE_MODEL_REQUIREMENTS } from './storage-model-requirements';

/** Solo importa la ubicación: las reglas no miran nada más del destino. */
const destination = (location: 'cloud' | 'on_premises'): Destination => ({ location }) as Destination;

const CLOUD = destination('cloud');
const LOCAL = destination('on_premises');

describe('STORAGE_MODEL_REQUIREMENTS (SPEC-803, tabla de verdad de las reglas por modelo)', () => {
  describe('cloud', () => {
    const rule = STORAGE_MODEL_REQUIREMENTS[DeploymentModel.CLOUD];

    it.each([
      ['sin destinos', [], false],
      ['solo local', [LOCAL], false],
      ['solo nube', [CLOUD], true],
      ['nube y local', [CLOUD, LOCAL], true],
    ])('satisfiedBy con %s → %p', (_label, available, expected) => {
      expect(rule.satisfiedBy(available)).toBe(expected);
    });

    it('acepta como predeterminado solo un destino de nube', () => {
      expect(rule.acceptsDefault(CLOUD)).toBe(true);
      expect(rule.acceptsDefault(LOCAL)).toBe(false);
    });

    it('nombra la ubicación que falta', () => {
      expect(rule.missingLocations([])).toEqual(['cloud']);
      expect(rule.missingLocations([CLOUD])).toEqual([]);
    });
  });

  describe('on_premises', () => {
    const rule = STORAGE_MODEL_REQUIREMENTS[DeploymentModel.ON_PREMISES];

    it.each([
      ['sin destinos', [], false],
      ['solo nube', [CLOUD], false],
      ['solo local', [LOCAL], true],
      ['nube y local', [CLOUD, LOCAL], true],
    ])('satisfiedBy con %s → %p', (_label, available, expected) => {
      expect(rule.satisfiedBy(available)).toBe(expected);
    });

    it('acepta como predeterminado solo un destino local', () => {
      expect(rule.acceptsDefault(LOCAL)).toBe(true);
      expect(rule.acceptsDefault(CLOUD)).toBe(false);
    });

    it('nombra la ubicación que falta', () => {
      expect(rule.missingLocations([CLOUD])).toEqual(['on_premises']);
      expect(rule.missingLocations([LOCAL])).toEqual([]);
    });
  });

  describe('hybrid', () => {
    const rule = STORAGE_MODEL_REQUIREMENTS[DeploymentModel.HYBRID];

    it.each([
      ['sin destinos', [], false],
      ['solo nube', [CLOUD], false],
      ['solo local', [LOCAL], false],
      ['nube y local', [CLOUD, LOCAL], true],
    ])('satisfiedBy con %s → %p', (_label, available, expected) => {
      expect(rule.satisfiedBy(available)).toBe(expected);
    });

    it('acepta cualquier destino disponible como predeterminado', () => {
      expect(rule.acceptsDefault(CLOUD)).toBe(true);
      expect(rule.acceptsDefault(LOCAL)).toBe(true);
    });

    it('nombra las ubicaciones que faltan', () => {
      expect(rule.missingLocations([])).toEqual(['cloud', 'on_premises']);
      expect(rule.missingLocations([CLOUD])).toEqual(['on_premises']);
      expect(rule.missingLocations([LOCAL])).toEqual(['cloud']);
      expect(rule.missingLocations([CLOUD, LOCAL])).toEqual([]);
    });
  });

  it('cubre los tres modelos del enum', () => {
    expect(Object.keys(STORAGE_MODEL_REQUIREMENTS).sort()).toEqual(
      Object.values(DeploymentModel).sort(),
    );
  });
});
